# Customer Care Executive — Mobile API

API contract for the **Customer Care Executive** mobile app (iOS / Android).

This document covers only the panel executives use today:

- Login (role-gated)
- Care task inbox + order workspace
- Delivered orders + upsell
- Create Shopify order + care-created orders
- Call history / recordings

**Base URL:** `https://<crm-host>` (Next.js origin)  
**Format:** JSON (`Content-Type: application/json`)  
**Auth:** `Authorization: Bearer <accessToken>` on every protected route

Related: broader CRM APIs live in [MOBILE_API.md](./MOBILE_API.md). Prefer this file for the care app.

---

## Table of contents

1. [Role-based login (required)](#1-role-based-login-required)
2. [Auth headers & token lifecycle](#2-auth-headers--token-lifecycle)
3. [Who sees what](#3-who-sees-what)
4. [Screen → API map](#4-screen--api-map)
5. [Conventions](#5-conventions)
6. [Auth endpoints](#6-auth-endpoints)
7. [Care tasks](#7-care-tasks)
8. [Order workspace](#8-order-workspace)
9. [Delivered orders & upsell](#9-delivered-orders--upsell)
10. [Create order](#10-create-order)
11. [Care-created orders](#11-care-created-orders)
12. [Calls & recordings](#12-calls--recordings)
13. [Push (optional)](#13-push-optional)
14. [Do not call from this app](#14-do-not-call-from-this-app)
15. [Error reference](#15-error-reference)
16. [Integration checklist](#16-integration-checklist)
17. [Endpoint index](#17-endpoint-index)

---

## 1. Role-based login (required)

This app is **only** for customer care executives.

Canonical role: **`care_executive`**  
Legacy alias still accepted by the server: **`support`**

Admin / employee / other CRM accounts must **not** enter the app, even if their password is valid.

### Server gate

Send `requiredRole: "care_executive"` on **login** and **refresh**. Tokens are issued only when the account’s role is `care_executive` or `support`.

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "shubham.kumar@fiberisefit.com",
  "password": "secret",
  "requiredRole": "care_executive",
  "deviceId": "stable-device-uuid",
  "deviceName": "iPhone 15",
  "platform": "ios"
}
```

| Result | Status | Body |
|--------|--------|------|
| Care executive, valid password | `200` | Tokens + `user.role` |
| Valid password, wrong role (admin, employee, …) | `403` | `{ "error": "This app is only available to customer care executives.", "role": "admin" }` |
| Bad email/password or inactive account | `401` | `{ "error": "Invalid email or password." }` |
| Rate limited | `429` | `{ "error": "…", "retryAfterSec": n }` |

**Do not store tokens on `403`.** Show the server `error` string and stay on the login screen.

### Client gate (also required)

After every successful login, refresh, or `GET /api/auth/me`, check:

```ts
function isCareExecutive(role?: string | null) {
  return role === 'care_executive' || role === 'support'
}

if (!isCareExecutive(user.role)) {
  clearTokens()
  showError('This app is only available to customer care executives.')
}
```

Web CRM login does **not** send `requiredRole`, so other roles can still use the dashboard.

---

## 2. Auth headers & token lifecycle

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Cookies are not used. Do not send session cookies.

| Token | Store in | Lifetime |
|-------|----------|----------|
| `accessToken` | Memory or encrypted store | **1 hour** (`expiresIn` seconds) |
| `refreshToken` | Keychain / Keystore | **30 days**, **rotated** on every refresh |

### Refresh flow

```
API 401
  → POST /api/auth/refresh { refreshToken, requiredRole: "care_executive", deviceId, platform }
  → replace BOTH tokens
  → retry original request once
  → if refresh 401/403 → clear session → login
```

Refresh tokens rotate: the previous refresh token is invalid after a successful refresh. Single-flight refreshes (one in-flight refresh; queue other 401s).

### Device metadata (send on login + refresh)

| Field | Type | Values |
|-------|------|--------|
| `deviceId` | string | Stable UUID for this install |
| `deviceName` | string | e.g. `"Pixel 8"` |
| `platform` | string | `"ios"` \| `"android"` |

### Rate limits (login & refresh)

8 failures / 15 minutes per IP + identity, then locked 15 minutes → `429` + `retryAfterSec`.

---

## 3. Who sees what

Every care-task API requires a Bearer token **and** a role that may use care APIs (`care_executive`, `support`, `employee`, `admin`, `super_admin`). Wrong role → `403 { "error": "Forbidden" }`.

For a logged-in **care executive**:

| Data | Scope |
|------|--------|
| Task list / summary / delivered orders | **Own queue only** (server ignores `?assignee=` from executives) |
| Task GET / PATCH / notes | Only tasks assigned to that executive |
| Created orders | Orders tagged as created by that executive |
| Order context / activity / catalog | Shared (needed to work a task) |

Do **not** send `assignee=` from the mobile app. Admins use that on the web.

---

## 4. Screen → API map

| App screen | Endpoints |
|------------|-----------|
| Login / session restore | `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me` |
| Logout | `POST /api/auth/logout` |
| Task inbox | `GET /api/care-tasks?groupBy=order&status=inbox`, `GET /api/care-tasks/summary` |
| Order / task workspace | `GET /api/care-tasks?order…` (or list `status=all&groupBy=order`), `GET /api/care-tasks/:id`, `GET /api/care-tasks/order-context`, `GET /api/care-tasks/activity`, `GET /api/care-tasks/escalation-targets` |
| Complete / COD / call-after / escalate | `PATCH /api/care-tasks/:id` |
| Notes | `POST /api/care-tasks/:id/notes` |
| Delivered orders | `GET /api/care-tasks/delivered-orders` |
| Start upsell | `POST /api/care-tasks/upsell` |
| Create order | `GET /api/care-tasks/shopify-products`, `POST /api/care-tasks/shopify-create-order` |
| Orders I created | `GET /api/care-tasks/created-orders` |
| Call log / play recording | `GET /api/customer-service/calls`, `GET /api/customer-service/calls/:callId/recording` |

---

## 5. Conventions

### Success

JSON objects. Lists often include `page`, `pageSize`, `total`, `totalPages`. Entities are wrapped (`{ "task": … }`, `{ "orders": […] }`).

### Errors

```json
{ "error": "Human-readable message" }
```

Optional: `role`, `retryAfterSec`, `details`.

| Code | Meaning |
|------|---------|
| `200` / `201` | OK / created |
| `400` | Validation |
| `401` | Missing / expired / invalid token, or bad credentials |
| `403` | Authenticated but role not allowed (login role gate **or** API Forbidden) |
| `404` | Not found |
| `429` | Rate limited |
| `500` / `502` | Server / Shopify / upstream |

### Dates

ISO-8601 (`2026-08-17T09:30:00.000Z`). Customer-service `from`/`to` also accept date-only strings.

### Pagination

Default `page=1`. Care lists default `pageSize=20` (max 100 on delivered / created-orders).

---

## 6. Auth endpoints

### `POST /api/auth/login`

**Auth:** Public

**Body**

```json
{
  "email": "string (required)",
  "password": "string (required)",
  "requiredRole": "care_executive",
  "deviceId": "string",
  "deviceName": "string",
  "platform": "ios | android"
}
```

`requiredRole` is **required for this app**. Omit it only on the web CRM.

**Response `200`**

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs…",
  "expiresIn": 3600,
  "user": {
    "id": "firestoreUserId",
    "name": "Shubham",
    "email": "shubham.kumar@fiberisefit.com",
    "role": "care_executive"
  }
}
```

**Errors:** `400` missing email/password · `401` invalid/inactive · `403` wrong role · `429` · `500`

---

### `POST /api/auth/refresh`

**Auth:** Public (uses `refreshToken`, not Bearer)

**Body**

```json
{
  "refreshToken": "string (required)",
  "requiredRole": "care_executive",
  "deviceId": "string",
  "deviceName": "string",
  "platform": "ios | android"
}
```

**Response `200`:** same shape as login (new rotated pair + `user`).

**Errors:** `400` · `401` invalid/expired refresh · `403` role no longer care executive · `429` · `500`

---

### `POST /api/auth/logout`

**Auth:** Public (Bearer optional)

**This device**

```json
{ "refreshToken": "string (required)" }
```

**All devices** (send Bearer **or** a valid `refreshToken`)

```json
{ "allDevices": true }
```

**Response:** `{ "success": true }` or `{ "success": true, "revokedCount": 3 }`

---

### `GET /api/auth/me`

**Auth:** Bearer

**Response `200`**

```json
{
  "authenticated": true,
  "user": {
    "id": "string",
    "name": "string",
    "email": "string",
    "role": "care_executive",
    "ipAddress": "string"
  }
}
```

Use on cold start. If `role` is not a care executive, log out.

**Errors:** `401` `{ "authenticated": false, "error": "No active session found." }`

---

## 7. Care tasks

### Task object (`CareTask`)

```ts
{
  id: string
  dedupeKey: string
  orderId: string
  orderName: string                  // e.g. "#1234"
  customerName: string
  phone: string
  paymentMethod: "cod" | "prepaid" | "unknown"
  packKey: string                    // "7" | "30" | "90" | …
  packLabel?: string
  taskType: string                   // cod_confirmation | introduction | review | courtesy | upsell | …
  taskLabel: string
  scheduleDay: number                // -1 COD, 0 intro, 3/5/15/23/30/60/90 follow-ups
  scheduledAt: string                // ISO
  orderCreatedAt?: string | null
  priority: "high" | "medium" | "low"
  status: "pending" | "completed" | "unreachable" | "rescheduled" | "escalated" | "not_interested"
  assignedTo: { userId: string, email: string, name: string } | null
  escalatedTo?: { userId: string, email: string, name: string } | null
  outcome?: string
  remarks?: string
  customerResponse?: string
  customerRating?: number            // 1–5
  lastUnreachableAt?: string | null
  rescheduledAt?: string | null
  notes: Array<{
    id: string
    text: string
    authorEmail: string
    authorName: string
    createdAt: string
  }>
  lastCall?: CareLinkedCall | null
  calls: CareLinkedCall[]
  createdAt: string
  updatedAt?: string
  completedAt?: string | null
  source: "auto" | "manual"
  careOrderTag?: "care_confirmed" | "care_cancelled" | "aisensy_confirmed" | null
}
```

`CareLinkedCall` (when present):

```ts
{
  callId: string
  startTime?: string
  duration?: number
  answered?: boolean
  inbound?: boolean
  number?: string
  formattedNumber?: string
  hasRecording?: boolean
  userName?: string
  attachedAt: string
}
```

### Kind tabs (`kind`)

| `kind` | Meaning |
|--------|---------|
| `all` | Default |
| `cod_confirmation` | COD confirmation |
| `introduction` | Intro call |
| `day_3` / `day_5` / `day_15` / `day_23` / `day_30` / `day_60` / `day_90` | Follow-ups (`day_28` aliases to `day_23`) |
| `upsell` | Manual / pack upsell call |
| `other` | Everything else |

### Status buckets (`status`)

| `status` | Meaning |
|----------|---------|
| `inbox` | **Default** — actionable queue |
| `today` | Due today |
| `upcoming` | Future |
| `overdue` | Past due |
| `pending` / `completed` / `rescheduled` / `escalated` / `unreachable` / `not_interested` | Exact status |
| `all` | No status filter |

### Order group (`CareOrderGroup`) when `groupBy=order`

```ts
{
  key: string
  orderId: string
  orderName: string
  customerName: string
  phone: string
  packKey: string
  packLabel?: string
  orderCreatedAt?: string | null
  paymentMethod: "cod" | "prepaid" | "unknown"
  assignedTo: CareTask["assignedTo"]
  tasks: CareTask[]
  focusTaskId: string               // task to open first
}
```

---

### `GET /api/care-tasks`

Inbox for the logged-in executive. Prefer **`groupBy=order`** (same as the web panel).

**Query**

| Param | Default | Notes |
|-------|---------|--------|
| `status` | `inbox` | See table above |
| `kind` | `all` | Kind tab |
| `search` | — | Name / phone / order |
| `page` | `1` | |
| `pageSize` | `20` | 20 / 50 / 100 typical |
| `sort` | `recent` (`due_asc` when `status=rescheduled`) | `recent` \| `due_asc` \| `due_desc` \| `created_desc` \| `priority` \| `name_asc` |
| `groupBy` | `task` | Use **`order`** for the inbox |
| `deliveredOnly` | `false` | `1` / `true` |
| `day` | `all` | `all` \| `5` \| `23` \| `90` \| `manual` |
| `pack` | `all` | `all` \| `7` \| `30` \| `90` |
| `assignee` | ignored for executives | Admin-only |

**Example**

```http
GET /api/care-tasks?status=inbox&kind=all&groupBy=order&page=1&pageSize=20
Authorization: Bearer <accessToken>
```

**Response**

```json
{
  "tasks": [ /* CareTask[] — also populated when groupBy=task */ ],
  "groups": [ /* CareOrderGroup[] when groupBy=order */ ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "kindCounts": { "cod_confirmation": 5, "introduction": 3, "upsell": 1 },
  "totalPages": 3
}
```

---

### `GET /api/care-tasks/summary`

Badge counts for the executive’s queue.

**Response**

```json
{
  "summary": {
    "total": 40,
    "pending": 12,
    "completed": 8,
    "overdue": 3,
    "today": 5,
    "upcoming": 10,
    "missed": 0,
    "escalated": 1,
    "rescheduled": 2,
    "unreachable": 1,
    "notInterested": 0
  }
}
```

---

### `GET /api/care-tasks/:id`

**Response:** `{ "task": { /* CareTask */ } }`  
**Errors:** `403` not assigned to you · `404`

---

### `PATCH /api/care-tasks/:id`

Workflow action. Always send **`action`** (do not rely on `status` alone).

#### Actions

| `action` | Required fields | Effect |
|----------|-----------------|--------|
| `confirm_cod` | — | Completes COD task; display tag `care_confirmed`. **Does not** change Shopify. |
| `cancel_cod` | `remarks?` | Completes COD task; display tag `care_cancelled`. **Does not** cancel Shopify. |
| `complete` | `outcome`, `remarks`, `customerResponse`; `customerRating` 1–5 **except** COD confirmation | Marks completed |
| `unreachable` | `remarks?`, `outcome?` | Marks unreachable (scheduler retries ~1 hour later) |
| `call_after` | `scheduledAt` ISO, future, **≤ 3 days**; `remarks?` | Reschedules |
| `reschedule` | `scheduledAt` ISO future; `remarks?` | Reschedules (no 3-day cap) |
| `not_interested` | `remarks` (reason); `customerResponse?` | Closes as not interested |
| `escalate` | `remarks` (reason), `escalatedTo` **or** `escalatedToEmail` | Reassigns to selected user |

**Complete (intro / follow-up / upsell)**

```json
{
  "action": "complete",
  "outcome": "Customer using product daily",
  "remarks": "Answered dosage questions",
  "customerResponse": "Happy with results",
  "customerRating": 5
}
```

**COD confirm / cancel**

```json
{ "action": "confirm_cod" }
```

```json
{ "action": "cancel_cod", "remarks": "Customer asked to cancel — wants a different pack" }
```

**Call after**

```json
{
  "action": "call_after",
  "scheduledAt": "2026-08-18T10:00:00.000Z",
  "remarks": "Asked to call tomorrow morning"
}
```

**Escalate** — load targets first (`GET /api/care-tasks/escalation-targets`)

```json
{
  "action": "escalate",
  "remarks": "Customer wants refund beyond policy",
  "escalatedTo": {
    "userId": "abc123",
    "email": "admin@fiberisefit.com",
    "name": "Admin"
  }
}
```

**Response:** `{ "task": { /* updated CareTask */ } }`

**Common `400`s**

- Missing outcome / remarks / customer response
- Missing or invalid `customerRating` (1–5) when required
- Call-after in the past or more than 3 days out
- Escalate without reason or without a target
- Unknown `action`

---

### `POST /api/care-tasks/:id/notes`

```json
{ "text": "Spoke to spouse; will call back" }
```

(`note` is accepted as an alias for `text`.)

**Response:** `{ "task": { … }, "note": { "id", "text", "authorEmail", "authorName", "createdAt" } }`

---

### `GET /api/care-tasks/escalation-targets`

Users the executive may escalate to.

**Response**

```json
{
  "users": [
    { "userId": "…", "email": "admin@fiberisefit.com", "name": "Admin" }
  ]
}
```

---

## 8. Order workspace

Same data the web order page uses: shipment snapshot, clone trail, activity, customer address.

### `GET /api/care-tasks/order-context`

**Query**

| Param | Required | Notes |
|-------|----------|--------|
| `orderId` | one of id/name | Shopify order id |
| `orderName` | one of id/name | e.g. `#1234` |
| `live` | no | `1` to hit Shiprocket for live AWB (slower). Default is cache-only. |

**Response (shape)**

```json
{
  "order": { "id", "name", "created_at", "status", "statusLabel", "awb", "courier", "etd", "shipmentStatus", "state", "city", "pincode" },
  "operational": { /* live clone, same slim shape */ },
  "parent": { /* or null */ },
  "clones": [],
  "delivered": false,
  "status": "in_transit",
  "statusLabel": "In transit",
  "state": "Delhi",
  "city": "New Delhi",
  "pincode": "110001",
  "etd": "2026-08-20",
  "timeline": [ /* shipment events */ ],
  "trackingLoaded": false,
  "customer": {
    "firstName": "Asha",
    "lastName": "Khan",
    "email": "asha@example.com",
    "phone": "+9198…",
    "address1": "…",
    "address2": null,
    "city": "New Delhi",
    "province": "Delhi",
    "zip": "110001",
    "country": "India"
  },
  "phoneKey": "9198…",
  "repeatedCustomer": true,
  "samePhoneOrders": [ { "id", "name", "created_at", "total_price", "statusLabel", "productTitle", "isCurrent" } ],
  "samePhoneOrderCount": 2
}
```

**404** if the order is not in the CRM orders cache (`Order not found in cache…`).

---

### `GET /api/care-tasks/activity`

Audit trail for the order workspace.

**Query:** `orderId` (required), `taskIds` optional comma-separated

**Response**

```json
{
  "logs": [
    {
      "id": "…",
      "action": "TASK_COMPLETED",
      "orderId": "123",
      "orderName": "#1234",
      "taskId": "…",
      "details": {},
      "status": "success",
      "createdAt": "2026-08-17T06:00:00.000Z"
    }
  ]
}
```

Typical `action` values: `TASK_COMPLETED`, `TASK_UNREACHABLE`, `TASK_CALL_AFTER`, `TASK_NOT_INTERESTED`, `TASK_ESCALATED`, `NOTE_ADDED`, `TASK_CONFIRMED` / status-derived `TASK_*`.

---

## 9. Delivered orders & upsell

Mirrors **Delivered Orders** in the web panel. Executives only see orders assigned to them (including a stable virtual split when no assignment is stored yet).

### `GET /api/care-tasks/delivered-orders`

**Query**

| Param | Default | Values |
|-------|---------|--------|
| `page` | `1` | |
| `pageSize` | `20` | max 100 (`per_page` alias accepted) |
| `search` | — | name / phone / customer |
| `upsell` | `all` | `all` \| `needs` \| `open` |
| `payment` | `all` | `all` \| `cod` \| `prepaid` |
| `datePreset` | `30days` | `7days` \| `30days` \| `90days` \| `all` |
| `sort` | `delivered_desc` | `delivered_desc` \| `delivered_asc` \| `ordered_desc` \| `ordered_asc` \| `total_desc` \| `total_asc` \| `name_asc` |

**Response**

```json
{
  "orders": [
    {
      "id": 123456,
      "name": "#1234",
      "created_at": "…",
      "total_price": "1999.00",
      "currency": "INR",
      "financial_status": "paid",
      "payment_method": "cod",
      "customer": { "first_name": "Asha", "last_name": "Khan", "email": "…", "phone": "…" },
      "shipping_address": { "city": "…", "province": "…", "phone": "…" },
      "care_tag": { "kind": "care_confirmed" },
      "care_executive": { "email": "…", "name": "Shubham", "virtual": false },
      "delivered_at": "2026-08-10T12:00:00.000Z",
      "hasOpenUpsell": false,
      "upsellTaskId": "…__upsell__…",
      "upsellStatus": null,
      "upsellAssignee": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 80, "totalPages": 4 },
  "summary": { "delivered": 80, "openUpsell": 12, "needsUpsell": 68, "assignee": "shubham.kumar@fiberisefit.com" },
  "filters": { "upsell": "all", "payment": "all", "datePreset": "30days", "sort": "delivered_desc" }
}
```

`hasOpenUpsell === false` → show **Create upsell task**. If true, deep-link to `upsellTaskId`.

---

### `POST /api/care-tasks/upsell`

Creates a manual **Upsell Call** task for a **delivered** order.

```json
{ "orderId": "123456", "orderName": "#1234" }
```

(`id` is accepted as an alias for `orderId`. At least one of `orderId` / `orderName` is required.)

**Response**

```json
{
  "success": true,
  "created": true,
  "task": { /* CareTask */ },
  "existing": null
}
```

If a matching open upsell already exists: `created: false`, `task` / `existing` is the current task.

**Errors:** `400` not delivered yet · `404` order not in cache

---

## 10. Create order

Mirrors **Create Order**. Creates a live Shopify order (draft → complete) tagged `care-created` + `care:<executive-email>`.

### `GET /api/care-tasks/shopify-products`

Variant catalog for the product picker. Cached ~5 minutes server-side. Max **200** variants returned.

**Query:** `q` optional (matches product title, variant title, SKU)

**Response**

```json
{
  "variants": [
    {
      "id": 111,
      "productId": 222,
      "productTitle": "Fiberise 30-Day Pack",
      "title": "Default",
      "sku": "FB-30",
      "price": "1999.00",
      "available": true
    }
  ],
  "total": 12
}
```

---

### `POST /api/care-tasks/shopify-create-order`

**Body**

```json
{
  "email": "optional@customer.com",
  "phone": "9876543210",
  "note": "WhatsApp order",
  "payment": "cod",
  "shipping": {
    "firstName": "Asha",
    "lastName": "Khan",
    "phone": "9876543210",
    "address1": "12 MG Road",
    "address2": "",
    "city": "Bengaluru",
    "province": "Karnataka",
    "zip": "560001",
    "country": "India"
  },
  "lineItems": [
    { "variantId": 111, "quantity": 1 },
    { "title": "Custom add-on", "quantity": 1, "price": "199" }
  ]
}
```

| Field | Rules |
|-------|--------|
| `payment` | `"cod"` (default) or `"paid"` (prepaid) |
| `phone` | Required (or `shipping.phone`) |
| `shipping.firstName`, `address1`, `city` | Required |
| `shipping.province` | State (also accepts `state`) |
| `shipping.zip` | Pincode (also accepts `pincode`) |
| `lineItems` | At least one. Catalog items: `variantId`. Custom: `title` + `price` |

**Response `200`**

```json
{
  "ok": true,
  "orderId": 555,
  "orderName": "#5555",
  "draftId": 77,
  "payment": "cod",
  "invoiceUrl": "https://…",
  "createdBy": { "email": "shubham.kumar@fiberisefit.com", "name": "Shubham" },
  "order": {
    "id": 555,
    "name": "#5555",
    "total_price": "1999.00",
    "financial_status": "pending",
    "created_at": "…"
  }
}
```

COD → Shopify payment pending. Prepaid/`paid` → marked paid. Share `invoiceUrl` with the customer when present.

**Errors:** `400` missing items / address / phone · `502` Shopify failure

---

## 11. Care-created orders

Mirrors **Created Orders**. Executives only see orders they created (`care:<email>` tag). `mine=1` is implied for this role.

### `GET /api/care-tasks/created-orders`

**Query**

| Param | Default | Values |
|-------|---------|--------|
| `page` | `1` | |
| `pageSize` | `20` | max 100 |
| `search` | — | name, customer, phone, product |
| `payment` | `all` | `all` \| `cod` \| `prepaid` |
| `status` | `all` | `all` \| `active` \| `cancelled` |
| `mine` | implied for executives | `1` unused for this role |

**Response**

```json
{
  "orders": [
    {
      "id": "555",
      "name": "#5555",
      "created_at": "…",
      "total_price": "1999.00",
      "currency": "INR",
      "financial_status": "pending",
      "fulfillment_status": null,
      "cancelled": false,
      "cancelled_at": null,
      "cancel_reason": null,
      "payment": "cod",
      "email": null,
      "phone": "9876543210",
      "customerName": "Asha Khan",
      "address1": "12 MG Road",
      "address2": null,
      "city": "Bengaluru",
      "province": "Karnataka",
      "zip": "560001",
      "country": "India",
      "note": "WhatsApp order",
      "tags": ["care-created", "cod", "care:shubham.kumar@fiberisefit.com"],
      "lineItems": [
        { "title": "Fiberise 30-Day Pack", "variantTitle": "Default", "sku": "FB-30", "quantity": 1, "price": "1999.00" }
      ],
      "createdByEmail": "shubham.kumar@fiberisefit.com",
      "createdByName": "Shubham"
    }
  ],
  "summary": { "total": 20, "mine": 20, "cod": 14, "prepaid": 6, "active": 18, "cancelled": 2 },
  "pagination": { "page": 1, "pageSize": 20, "total": 20, "totalPages": 1 }
}
```

Summary counts are computed **before** payment/status/search filters (same as web).

---

## 12. Calls & recordings

Salestrail-backed history. Default range: **last 30 days**. Upstream can take up to ~60s — use a long timeout.

Care executives may call these routes. Filter by the executive’s phone / name with `user` or `phone` when you only want their dials.

### `GET /api/customer-service/calls`

**Query**

| Param | Default | Notes |
|-------|---------|--------|
| `from` / `to` | last 30 days | ISO or date |
| `page` | `1` | |
| `pageSize` | `25` | |
| `sortBy` | `startTime` | |
| `sortDir` | `desc` | `asc` \| `desc` |
| `includeSummary` | `false` | `true` adds aggregate `summary` |
| `search` | — | |
| `user` | — | Agent name/email |
| `phone` | — | Customer number |
| `answered` | `all` | |
| `direction` | `all` | inbound / outbound |
| `hasRecording` | — | `true` to require recording |
| `byCreated` | `false` | Filter by created time instead of start |

**Response:** `{ "calls": […], "total", "page", "pageSize", "totalPages", "summary"? }`

Each call includes `callId`. If `hasRecording` / rec fields are set, play via the recording endpoint.

---

### `GET /api/customer-service/calls/:callId/recording`

| Query | Behavior |
|-------|----------|
| `mode=url` | **Preferred on mobile** — `{ "url": "<temporary blob URL>" }` |
| `mode=proxy` (default) | Stream audio bytes through the CRM (`audio/*`, Range supported) |
| `mode=redirect` | `302` to temporary URL |
| `download=1` | Attachment filename |

**404** `{ "error": "Recording not available." }`

---

Optional (same auth; usually web-only):

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/customer-service/dashboard?from=&to=` | `{ summary, recentCalls, charts }` |
| `GET` | `/api/customer-service/analytics?from=&to=` | Analytics |
| `GET` | `/api/customer-service/calls/csv` | CSV export |
| `GET` | `/api/customer-service/integration` | Integration logs |

---

## 13. Push (optional)

### `POST /api/register-token`

Register FCM after login.

```json
{ "token": "<fcm-device-token>" }
```

---

## 14. Do not call from this app

| Path | Why |
|------|-----|
| `GET /api/care-tasks/performance` | Admin only |
| `POST /api/care-tasks/generate` | Ops / web sync |
| `POST /api/care-tasks/sync-calls` | Ops |
| `POST /api/auth/register` | Admin creates users |
| `/api/shopify/orders` list/analytics | Full orders hub — use `order-context` instead |
| `/api/webhooks/*`, `/api/cron/*` | Internal |
| WhatsApp / CRM journeys / audit / Shiprocket admin | Not part of the care panel |

`confirm_cod` / `cancel_cod` are **display tags only**. They do not fulfill, cancel, or edit the Shopify order.

---

## 15. Error reference

| Status | Body | Client action |
|--------|------|----------------|
| `401` | `{ "error": "Unauthorized" }` | Refresh once with `requiredRole`; else login |
| `401` | `{ "error": "Invalid email or password." }` | Show on login |
| `401` | `{ "error": "Invalid or expired refresh token." }` | Clear tokens → login |
| `403` | `{ "error": "This app is only available to customer care executives.", "role": "…" }` | Stay logged out; do not store tokens |
| `403` | `{ "error": "Forbidden" }` | Hide feature / task not assigned to this executive |
| `404` | `{ "error": "Not found" }` or cache miss | Refresh list / ask ops to refresh Order Status |
| `429` | `{ "error": "…", "retryAfterSec": 900 }` | Back off |
| `500` / `502` | `{ "error": "…" }` | Retry with backoff |

---

## 16. Integration checklist

### Auth

- [ ] Always send `requiredRole: "care_executive"` on login **and** refresh
- [ ] Also reject locally unless `role` is `care_executive` or `support`
- [ ] Persist `refreshToken` in Keychain / Keystore
- [ ] Persist `user.role`, `user.email`, `user.name`, `user.id`
- [ ] Send `platform` + stable `deviceId`
- [ ] On `401`, single-flight refresh, replace **both** tokens
- [ ] Timeouts: calls + order-context `live=1` can exceed 30s

### Inbox

- [ ] `GET /api/care-tasks?status=inbox&groupBy=order`
- [ ] Summary chips from `GET /api/care-tasks/summary`
- [ ] Open workspace with `orderId` + `focusTaskId`

### Workspace

- [ ] Load context (`order-context`) + activity + task detail
- [ ] COD: Confirm / Cancel Requested
- [ ] Other tasks: Complete (rating 1–5), Unreachable, Call After (≤ 3 days), Not interested, Escalate
- [ ] Notes

### Other tabs

- [ ] Delivered orders + create upsell
- [ ] Product search + create order (COD / prepaid)
- [ ] Created-orders list
- [ ] Optional: call history + `mode=url` recordings
- [ ] Optional: FCM `register-token`

### Pseudocode

```ts
const CARE_ROLES = new Set(['care_executive', 'support'])

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      requiredRole: 'care_executive',
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      platform: Platform.OS, // 'ios' | 'android'
    }),
  })
  const data = await res.json()
  if (res.status === 403) throw new Error(data.error)
  if (!res.ok) throw new Error(data.error || 'Login failed')
  if (!CARE_ROLES.has(data.user.role)) throw new Error('This app is only available to customer care executives.')
  saveTokens(data.accessToken, data.refreshToken, data.expiresIn)
  saveUser(data.user)
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init.headers || {}),
    },
  })
  if (res.status !== 401) return res

  const refreshed = await refreshTokens() // POST /api/auth/refresh + requiredRole
  if (!refreshed) {
    clearSession()
    throw new Error('Session expired')
  }
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init.headers || {}),
    },
  })
}
```

---

## 17. Endpoint index

| Method | Path | Auth | Care app |
|--------|------|------|----------|
| POST | `/api/auth/login` | Public + `requiredRole` | Yes |
| POST | `/api/auth/refresh` | Public + `requiredRole` | Yes |
| POST | `/api/auth/logout` | Public | Yes |
| GET | `/api/auth/me` | Bearer | Yes |
| GET | `/api/care-tasks` | Bearer + care | Yes |
| GET | `/api/care-tasks/summary` | Bearer + care | Yes |
| GET | `/api/care-tasks/:id` | Bearer + assigned | Yes |
| PATCH | `/api/care-tasks/:id` | Bearer + assigned | Yes |
| POST | `/api/care-tasks/:id/notes` | Bearer + assigned | Yes |
| GET | `/api/care-tasks/order-context` | Bearer + care | Yes |
| GET | `/api/care-tasks/activity` | Bearer + care | Yes |
| GET | `/api/care-tasks/escalation-targets` | Bearer + care | Yes |
| GET | `/api/care-tasks/delivered-orders` | Bearer + care | Yes |
| POST | `/api/care-tasks/upsell` | Bearer + care | Yes |
| GET | `/api/care-tasks/shopify-products` | Bearer + care | Yes |
| POST | `/api/care-tasks/shopify-create-order` | Bearer + care | Yes |
| GET | `/api/care-tasks/created-orders` | Bearer + care | Yes |
| GET | `/api/customer-service/calls` | Bearer | Yes |
| GET | `/api/customer-service/calls/:callId/recording` | Bearer | Yes |
| POST | `/api/register-token` | Bearer | Optional |

---

*Source of truth: `app/api/auth/*` and `app/api/care-tasks/*` route handlers. If a shape drifts, trust the route.*
