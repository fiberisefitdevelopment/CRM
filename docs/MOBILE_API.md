# Fiberise CRM — Mobile API Integration Guide

API reference for mobile clients (iOS / Android) integrating with the Fiberise CRM backend.

**Care executive app:** use **[CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md)** instead. It is the complete contract for the customer-care panel (role-gated login, tasks, delivered orders, create order, calls).

**Base URL:** `https://<your-crm-host>` (the Next.js app origin)  
**Format:** JSON (`Content-Type: application/json`)  
**Auth:** `Authorization: Bearer <accessToken>` on all protected routes

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Authentication](#2-authentication)
3. [Roles & access](#3-roles--access)
4. [Conventions](#4-conventions)
5. [Auth endpoints](#5-auth-endpoints)
6. [Care tasks](#6-care-tasks)
7. [Customer service (calls)](#7-customer-service-calls)
8. [Orders & tracking](#8-orders--tracking)
9. [Shiprocket](#9-shiprocket)
10. [Push notifications (FCM)](#10-push-notifications-fcm)
11. [Support tickets](#11-support-tickets)
12. [WhatsApp & CRM journeys (admin)](#12-whatsapp--crm-journeys-admin)
13. [Audit & reports (admin)](#13-audit--reports-admin)
14. [Do not call from mobile](#14-do-not-call-from-mobile)
15. [Error reference](#15-error-reference)
16. [Mobile integration checklist](#16-mobile-integration-checklist)

---

## 1. Quick start

```text
1. POST /api/auth/login          → store accessToken + refreshToken
2. Call APIs with                → Authorization: Bearer <accessToken>
3. On HTTP 401                   → POST /api/auth/refresh, retry once
4. On logout                     → POST /api/auth/logout with refreshToken
```

### Minimal login example

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "executive@example.com",
  "password": "secret",
  "deviceId": "device-uuid",
  "deviceName": "Pixel 8",
  "platform": "android"
}
```

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs…",
  "expiresIn": 3600,
  "user": {
    "id": "abc123",
    "name": "executive",
    "email": "executive@example.com",
    "role": "care_executive"
  }
}
```

Store:

| Token | Where | Lifetime |
|-------|--------|----------|
| `accessToken` | Memory / secure store | **1 hour** (`expiresIn` seconds) |
| `refreshToken` | Secure storage (Keychain / Keystore) | **30 days** (rotated on every refresh) |

---

## 2. Authentication

### Headers

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Cookies are **not** used for API auth. Do not rely on session cookies.

### Public routes (no Bearer required)

| Path | Notes |
|------|--------|
| `POST /api/auth/login` | |
| `POST /api/auth/refresh` | |
| `POST /api/auth/logout` | Optional Bearer |
| `/api/webhooks/*` | Shopify only — not for mobile |
| `/api/cron/*` | Internal only — not for mobile |

All other `/api/*` routes require a valid access token. Missing/invalid token → `401 { "error": "Unauthorized" }`.

### Token refresh flow (required)

Refresh tokens are **rotated**: each successful refresh invalidates the previous refresh token. Always replace both tokens in secure storage.

```text
API call → 401
  → POST /api/auth/refresh { refreshToken, deviceId?, platform? }
  → save new accessToken + refreshToken
  → retry original request once
  → if refresh fails 401 → force re-login
```

### Rate limits (login & refresh)

- **8 failures / 15 minutes** per IP + identity
- Then locked for **15 minutes**
- Response: `429` with `{ "error": "…", "retryAfterSec": <n> }`

### Device metadata (recommended)

Pass on login and refresh so sessions can be audited / revoked:

| Field | Type | Values |
|-------|------|--------|
| `deviceId` | string | Stable device UUID |
| `deviceName` | string | Human-readable device name |
| `platform` | string | `"ios"` \| `"android"` \| `"web"` |

---

## 3. Roles & access

| Role | Typical mobile access |
|------|------------------------|
| `care_executive` / `support` | Care tasks + customer-service APIs + auth |
| `employee` | Care tasks (API allowlist may vary by route) |
| `admin` / `super_admin` | Full CRM APIs |

Care executives are intended to use:

- `/api/auth/*`
- `/api/care-tasks/*`
- `/api/customer-service/*`

Calling admin-only routes (e.g. audit logs, register user) returns `403`.

---

## 4. Conventions

### Success

JSON objects; many include `"success": true`. Resource payloads often wrap entities (`{ "task": … }`, `{ "orders": […] }`).

### Errors

```json
{ "error": "Human-readable message" }
```

Optional fields: `details`, `retryAfterSec`, `raw`.

### HTTP status codes

| Code | Meaning |
|------|---------|
| `200` / `201` | OK / created |
| `400` | Validation / bad request |
| `401` | Missing, expired, or invalid token |
| `403` | Authenticated but role not allowed |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate user) |
| `422` | Business rule failure |
| `429` | Rate limited |
| `500` / `502` | Server / upstream failure |

### Pagination variants

Some endpoints use:

```json
{ "page": 1, "pageSize": 20, "total": 100, "totalPages": 5 }
```

Others (Shopify-style) use `per_page` / `total_pages`. Check each endpoint.

### Dates

Prefer ISO-8601 strings (e.g. `"2026-08-05T06:30:00.000Z"`). Date filters on customer-service may accept date-only inputs.

---

## 5. Auth endpoints

### `POST /api/auth/login`

**Auth:** Public

**Body**

```json
{
  "email": "string (required)",
  "password": "string (required)",
  "requiredRole": "care_executive (optional — required for the care executive app)",
  "deviceId": "string (optional)",
  "deviceName": "string (optional)",
  "platform": "ios | android | web (optional)"
}
```

**Response `200`**

```json
{
  "success": true,
  "accessToken": "string",
  "refreshToken": "string",
  "expiresIn": 3600,
  "user": {
    "id": "string",
    "name": "string",
    "email": "string",
    "role": "string"
  }
}
```

**Errors:** `400`, `401` (invalid credentials / inactive), `403` (role mismatch when `requiredRole` is sent), `429`, `500`

The care-executive mobile app **must** send `"requiredRole": "care_executive"`. Wrong-role accounts receive `403` and no tokens. See [CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md).

---

### `POST /api/auth/refresh`

**Auth:** Public

**Body**

```json
{
  "refreshToken": "string (required)",
  "requiredRole": "care_executive (optional — required for the care executive app)",
  "deviceId": "string (optional)",
  "deviceName": "string (optional)",
  "platform": "string (optional)"
}
```

**Response `200`:** Same shape as login (new rotated token pair + `user`).

**Errors:** `400`, `401`, `403` (role mismatch when `requiredRole` is sent), `429`, `500`

---

### `POST /api/auth/logout`

**Auth:** Public (Bearer optional)

**Logout this device**

```json
{ "refreshToken": "string (required)" }
```

**Logout all devices**

```json
{ "allDevices": true }
```

For `allDevices`, send Bearer **or** a valid `refreshToken` so the server can resolve the user.

**Response**

```json
{ "success": true }
```

or

```json
{ "success": true, "revokedCount": 3 }
```

---

### `GET /api/auth/me`

**Auth:** Bearer required

**Response `200`**

```json
{
  "authenticated": true,
  "user": {
    "id": "string",
    "name": "string",
    "email": "string",
    "role": "string",
    "ipAddress": "string"
  }
}
```

Use after cold start to validate the stored access token (or refresh first).

---

### `POST /api/auth/register`

**Auth:** Bearer + `admin` / `super_admin` only

**Body**

```json
{
  "email": "string",
  "password": "string (min 6 chars)",
  "name": "string (optional)",
  "role": "string (optional)"
}
```

**Response `201`:** `{ "success": true, "message": "…", "userId": "…" }`

Not needed for end-user mobile apps unless you ship an admin console.

---

## 6. Care tasks

Primary domain for care-executive mobile apps.

**Auth:** Bearer + role with care access (`care_executive`, `support`, `employee`, `admin`, `super_admin`)

### Task object (`CareTask`)

```ts
{
  id: string
  dedupeKey: string
  orderId: string
  orderName: string
  customerName: string
  phone: string
  paymentMethod: "cod" | "prepaid" | "unknown"
  packKey: string
  packLabel?: string
  taskType: string          // e.g. "cod_confirmation", "introduction", "review"
  taskLabel: string
  scheduleDay: number       // -1 COD, 0 intro, 3/5/15/23/30/60/90 follow-ups
  scheduledAt: string       // ISO
  orderCreatedAt?: string | null
  priority: "high" | "medium" | "low"
  status: "pending" | "completed" | "unreachable" | "rescheduled" | "escalated"
  assignedTo: { userId: string, email: string, name: string } | null
  outcome?: string
  remarks?: string
  customerResponse?: string
  customerRating?: number   // 1–5
  lastUnreachableAt?: string | null
  rescheduledAt?: string | null
  notes: Array<{
    id: string
    text: string
    authorEmail: string
    authorName: string
    createdAt: string
  }>
  lastCall?: object | null
  calls: object[]
  createdAt: string
  updatedAt?: string
  completedAt?: string | null
  source: "auto" | "manual"
  careOrderTag?: "care_confirmed" | "care_cancelled" | "aisensy_confirmed" | null
}
```

### Kind tabs (UI filters)

| `kind` query | Meaning |
|--------------|---------|
| `all` | Default when omitted on some UIs; list default is `all` |
| `cod_confirmation` | COD confirmation |
| `introduction` | Intro call |
| `day_3` / `day_5` / `day_15` / `day_23` / `day_30` / `day_60` / `day_90` | Follow-ups (`day_28` aliases to `day_23`) |
| `other` | Everything else |

### Status buckets (list filter)

| `status` query | Meaning |
|----------------|---------|
| `inbox` | Default — actionable queue |
| `today` | Due today |
| `upcoming` | Future |
| `overdue` | Past due |
| `pending` / `completed` / `rescheduled` / `escalated` / `unreachable` | Exact status |
| `all` | No status filter |

---

### `GET /api/care-tasks`

**Query**

| Param | Default | Notes |
|-------|---------|--------|
| `status` | `inbox` | See table above |
| `kind` | `all` | Kind tab |
| `search` | — | Name / phone / order search |
| `page` | `1` | |
| `pageSize` | `20` | |
| `assignee` | — | Admin only — filter by executive email |

**Response**

```json
{
  "tasks": [ /* CareTask[] */ ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "kindCounts": { "cod_confirmation": 5, "introduction": 3 },
  "totalPages": 3
}
```

---

### `GET /api/care-tasks/:id`

**Response:** `{ "task": { /* CareTask */ } }`  
**Errors:** `403`, `404`

---

### `PATCH /api/care-tasks/:id`

Perform a workflow action. Prefer sending `action` (not only `status`).

#### Actions

| `action` | Required body fields | Effect |
|----------|----------------------|--------|
| `confirm_cod` | — | Completes COD task; sets display tag `care_confirmed` (**does not** cancel Shopify order) |
| `cancel_cod` | — | Completes COD task; sets display tag `care_cancelled` (**does not** cancel Shopify order) |
| `complete` | `outcome`, `remarks`, `customerResponse`; `customerRating` (1–5) required except COD confirmation | Marks completed |
| `unreachable` | `remarks?`, `outcome?` | Reschedules +1 hour automatically |
| `call_after` | `scheduledAt` (ISO, future, ≤ 3 days), `remarks?` | Reschedule within 3 days |
| `reschedule` | `scheduledAt`, `remarks?` | Reschedule to given time |
| `escalate` | `remarks` (required reason), `outcome?` | Escalates task |

**Complete example**

```json
{
  "action": "complete",
  "outcome": "Customer satisfied with product",
  "remarks": "Answered product usage questions",
  "customerResponse": "Happy with results",
  "customerRating": 5
}
```

**Call after example**

```json
{
  "action": "call_after",
  "scheduledAt": "2026-08-06T10:00:00.000Z",
  "remarks": "Customer asked to call tomorrow morning"
}
```

**Response:** `{ "task": { /* updated CareTask */ } }`

**Common errors**

- `400` missing outcome/remarks/customerResponse
- `400` missing/invalid `customerRating` (1–5) when required
- `400` call-after outside window / in the past
- `400` unknown action

---

### `POST /api/care-tasks/:id/notes`

**Body**

```json
{ "text": "Spoke to spouse; will call back" }
```

(`note` is accepted as an alias for `text`.)

**Response:** `{ "task": { … }, "note": { id, text, authorEmail, authorName, createdAt } }`

---

### `GET /api/care-tasks/summary`

Optional query: `assignee` (admin only).

**Response:** `{ "summary": { /* counts object */ } }`

---

### `GET /api/care-tasks/order-context`

Slim order + timeline for the task expand panel (care executives do **not** need full Shopify Orders API).

**Query:** `orderId` and/or `orderName` (at least one)

**Response (shape)**

```json
{
  "order": { "id", "name", "created_at", "status", "statusLabel", "awb", "courier", "etd", "shipmentStatus" },
  "operational": { /* same slim shape */ },
  "parent": { /* or null */ },
  "clones": [ /* slim orders */ ],
  "timeline": [ /* events */ ],
  "tracking": { /* Shiprocket tracking or null */ }
}
```

**404** if order is not in the server orders cache (ops may need to refresh Order Status once).

---

### `GET /api/care-tasks/performance`

**Auth:** Admin only  
**Response:** `{ "executives": [ /* performance rows */ ] }`

---

### Ops helpers (usually not for field mobile UX)

| Method | Path | Body | Notes |
|--------|------|------|--------|
| `POST` | `/api/care-tasks/generate` | `{ maxOrders?, refresh? }` | Rebuild tasks from orders |
| `POST` | `/api/care-tasks/sync-calls` | `{ hoursBack? }` (default 48) | Attach Salestrail calls to tasks |

---

## 7. Customer service (calls)

Salestrail-backed call history. Default date range: **last 30 days**. Upstream can take up to ~60s.

**Auth:** Bearer

### `GET /api/customer-service/calls`

**Query**

| Param | Default | Notes |
|-------|---------|--------|
| `from` / `to` | last 30 days | ISO or date input |
| `byCreated` | `false` | Use created time instead of start |
| `page` | `1` | |
| `pageSize` | `25` | |
| `sortBy` | `startTime` | |
| `sortDir` | `desc` | `asc` \| `desc` |
| `includeSummary` | `false` | Attach aggregate summary |
| `search` | — | Free text |
| `user` | — | Agent filter |
| `phone` | — | |
| `answered` | `all` | |
| `direction` | `all` | inbound / outbound filters |
| `integrated` | `all` | |
| `source` / `sourceDetail` | — | |
| `hasRecording` | — | set `true` to require recording |

**Response**

```json
{
  "calls": [ /* … */ ],
  "total": 100,
  "page": 1,
  "pageSize": 25,
  "totalPages": 4,
  "summary": { /* only if includeSummary=true */ }
}
```

---

### `GET /api/customer-service/calls/:callId/recording`

| Query | Behavior |
|-------|----------|
| `mode=proxy` (default) | Stream audio bytes (`Content-Type: audio/*`, supports ranges) |
| `mode=url` | `{ "url": "<temporary blob URL>" }` |
| `mode=redirect` | `302` to temporary URL |
| `download=1` | `Content-Disposition: attachment` |

**Mobile tip:** Prefer `mode=url` to feed a native audio player, or `mode=proxy` if you need authenticated streaming through the CRM host.

---

### `GET /api/customer-service/calls/csv`

Same filters as list; returns CSV download (`filtered=true` optional).

### `GET /api/customer-service/dashboard`

Query: `from`, `to` → `{ summary, recentCalls, charts }`

### `GET /api/customer-service/analytics`

Query: `from`, `to` → full analytics object

### `GET /api/customer-service/integration`

Integration logs: `from`, `to`, `page`, `pageSize`, `search`, `status`, `user`

---

## 8. Orders & tracking

**Auth:** Bearer (admin / ops roles typically)

### `GET /api/shopify/orders`

Rich filtered list. Important query params:

| Param | Notes |
|-------|--------|
| `page`, `per_page` | `per_page` capped at 100 |
| `all=true` | Fetch all (heavy) |
| `refresh=true` | Bypass/refresh cache |
| `view=order_status` | Order-status shaped payload |
| `tab`, `search` | UI filters |
| `financial`, `payment`, `channel`, `courier`, `pickup`, `weight`, `rto` | Filters |
| `min_price`, `max_price` | |
| `date_preset`, `start_date`, `end_date` | |
| `fulfillment`, `delivery`, `payment_status` | |
| `include_test` | Include test orders |

**Response (high level):** `{ orders, pagination, tabCounts, isOffline, syncing, … }`

### `GET /api/shopify/orders/:id`

`{ "order": { … } }`

### `PATCH /api/shopify/orders/:id`

```json
{ "is_test_order": true }
```

### `PUT /api/shopify/orders/:id`

```json
{ "note": "Internal note text" }
```

### `DELETE /api/shopify/orders/:id`

Cancel single order.

### `DELETE /api/shopify/orders`

```json
{ "ids": ["123", "456"] }
```

### Analytics

| Method | Path |
|--------|------|
| `GET` | `/api/shopify/zone-analytics` |
| `GET` | `/api/shopify/gender-analytics?refresh=true` |
| `GET` | `/api/shopify/pincode-analytics?pincodes=&city=&state=&zone=` |

### `GET /api/order-status/track?awb=<AWB>`

Shiprocket tracking by AWB.

**Required:** `awb` query param  
**Response:** Shiprocket tracking JSON  
**400** if `awb` missing

---

## 9. Shiprocket

**Auth:** Bearer. Proxies Shiprocket External API; credentials stay server-side.

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/shiprocket/create-order` | Adhoc shipment payload (`order_id`, `pickup_location`, `order_items[]`, billing fields, `payment_method`, …) | Shiprocket create response |
| `POST` | `/api/shiprocket/manifest` | `{ orderNames?: string[], shipmentIds?: number[] }` | `{ "manifestUrl": "…" }` |
| `POST` | `/api/shiprocket/label` | same | `{ "labelUrl": "…" }` |
| `POST` | `/api/shiprocket/invoice` | `{ orderNames?: string[], orderIds?: number[] }` | `{ "invoiceUrl": "…" }` |

---

## 10. Push notifications (FCM)

**Auth:** Bearer

### `POST /api/register-token`

Register the device FCM token after login / token refresh.

```json
{ "token": "<fcm-device-token>" }
```

### `POST /api/send`

```json
{
  "token": "<fcm-token>",
  "title": "string",
  "body": "string",
  "data": { "optional": "map" }
}
```

### `POST /api/send-all`

```json
{ "title": "string", "body": "string", "data": {} }
```

### `POST /api/broadcast-personalized`

Admin/ops broadcast (`batchSize?`, `useRecommendedCategory?`).

---

## 11. Support tickets

**Auth:** Bearer. Proxied to Wellness API.

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/support/tickets?limit=&status=` | List |
| `PUT` | `/api/support/tickets` | Body must include `id` |
| `GET` | `/api/support/tickets/:id/comments?limit=` | List comments |
| `POST` | `/api/support/tickets/:id/comments` | `{ "message": "…", "authorType": "…" }` |

---

## 12. WhatsApp & CRM journeys (admin)

**Auth:** Bearer. Primarily admin / ops tooling.

### WhatsApp

| Method | Path | Purpose |
|--------|------|---------|
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/whatsapp/templates` | Template CRUD (`DELETE` uses `?id=`) |
| `POST` | `/api/whatsapp/templates/seed` | Seed defaults |
| `GET` / `PATCH` | `/api/whatsapp/journeys` | List / pause-resume (`journeyId`, `status`) |
| `GET` / `POST` | `/api/whatsapp/logs` | List / retry (`{ logId }`) |
| `GET` | `/api/whatsapp/analytics` | Analytics |
| `GET` / `POST` | `/api/whatsapp/scheduler` | Status / manual tick |

### CRM customer journeys

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/crm/customer-journeys` | `search`, `stage`, `status`, dates, `page`, `limit` |
| `GET` | `/api/crm/customer-journeys/analytics` | Analytics |
| `GET` | `/api/crm/customer-journeys/:id` | Journey + logs |
| `POST` | `/api/crm/customer-journeys/:id` | `{ "action": "retry" \| "trigger", "stage?": "…" }` |

---

## 13. Audit & reports (admin)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| `GET` | `/api/audit-logs` | `admin` / `super_admin` | Filters: `page`, `per_page`, `action_type`, `module`, `user`, `status`, `search`, `start_date`, `end_date`, `ip` |
| `GET` | `/api/reports/shipment/download?startDate=&endDate=` | Bearer | PDF (`Content-Type: application/pdf`) |
| `GET` | `/api/health` | Bearer | `{ "status": "OK", "message": "…" }` |

---

## 14. Do not call from mobile

These exist for Shopify / schedulers / debugging. Do **not** expose or call from the app:

| Path | Reason |
|------|--------|
| `POST /api/webhooks/shopify/order-created` | Shopify HMAC webhook |
| `GET`/`POST` `/api/cron/*` | Internal schedulers (no JWT) |
| `GET /api/debug/shiprocket-order` | Debug dump |

---

## 15. Error reference

| Status | Typical body | Client action |
|--------|--------------|---------------|
| `401` | `{ "error": "Unauthorized" }` | Refresh token once; else login |
| `401` | `{ "error": "Invalid email or password." }` | Show login error |
| `401` | `{ "error": "Invalid or expired refresh token." }` | Clear tokens → login |
| `403` | `{ "error": "Forbidden" }` | Hide feature / wrong role |
| `404` | `{ "error": "Not found" }` | Remove from UI / refresh list |
| `429` | `{ "error": "…", "retryAfterSec": 900 }` | Back off using `retryAfterSec` |
| `500` | `{ "error": "…" }` | Retry with backoff; show generic error |

---

## 16. Mobile integration checklist

### Storage

- [ ] Persist `refreshToken` in Keychain (iOS) / EncryptedSharedPreferences or Keystore (Android)
- [ ] Keep `accessToken` in memory preferred; secure store OK if encrypted
- [ ] Persist `user.role` for feature gating
- [ ] Persist `deviceId` across reinstalls if possible (or regenerate and pass consistently per install)

### Networking

- [ ] Attach `Authorization: Bearer <accessToken>` on every protected request
- [ ] On `401`, single-flight refresh (one refresh at a time; queue other requests)
- [ ] After refresh, replace **both** tokens (rotation)
- [ ] Send `platform: "ios" | "android"` and `deviceId` on login/refresh
- [ ] Handle `429` with `retryAfterSec`
- [ ] Timeouts: customer-service & order list can be slow (30–60s+)

### Care executive MVP screens

1. Login / logout / session restore (`/api/auth/*`)
2. Task inbox (`GET /api/care-tasks`)
3. Task detail (`GET /api/care-tasks/:id`)
4. Complete / COD confirm / unreachable / call-after / escalate (`PATCH`)
5. Notes (`POST …/notes`)
6. Order context (`GET /api/care-tasks/order-context`)
7. Call history + recording (`/api/customer-service/calls*`)
8. Optional: FCM register (`POST /api/register-token`)

### Pseudocode — authenticated fetch

```ts
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init.headers || {}),
    },
  })

  if (res.status !== 401) return res

  const refreshed = await refreshTokens() // POST /api/auth/refresh
  if (!refreshed) {
    clearSession()
    throw new Error('Session expired')
  }

  return fetch(`${BASE_URL}${path}`, {
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

## Appendix — Endpoint index

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public |
| POST | `/api/auth/logout` | Public |
| GET | `/api/auth/me` | Bearer |
| POST | `/api/auth/register` | Bearer + admin |
| GET | `/api/care-tasks` | Bearer + care |
| GET | `/api/care-tasks/:id` | Bearer + care |
| PATCH | `/api/care-tasks/:id` | Bearer + care |
| POST | `/api/care-tasks/:id/notes` | Bearer + care |
| GET | `/api/care-tasks/summary` | Bearer + care |
| GET | `/api/care-tasks/performance` | Bearer + admin |
| GET | `/api/care-tasks/order-context` | Bearer + care |
| POST | `/api/care-tasks/generate` | Bearer + care |
| POST | `/api/care-tasks/sync-calls` | Bearer + care |
| GET | `/api/customer-service/calls` | Bearer |
| GET | `/api/customer-service/calls/csv` | Bearer |
| GET | `/api/customer-service/calls/:callId/recording` | Bearer |
| GET | `/api/customer-service/dashboard` | Bearer |
| GET | `/api/customer-service/analytics` | Bearer |
| GET | `/api/customer-service/integration` | Bearer |
| GET | `/api/shopify/orders` | Bearer |
| GET/PATCH/PUT/DELETE | `/api/shopify/orders/:id` | Bearer |
| DELETE | `/api/shopify/orders` | Bearer |
| GET | `/api/shopify/zone-analytics` | Bearer |
| GET | `/api/shopify/gender-analytics` | Bearer |
| GET | `/api/shopify/pincode-analytics` | Bearer |
| GET | `/api/order-status/track` | Bearer |
| POST | `/api/shiprocket/create-order` | Bearer |
| POST | `/api/shiprocket/manifest` | Bearer |
| POST | `/api/shiprocket/label` | Bearer |
| POST | `/api/shiprocket/invoice` | Bearer |
| POST | `/api/register-token` | Bearer |
| POST | `/api/send` | Bearer |
| POST | `/api/send-all` | Bearer |
| POST | `/api/broadcast-personalized` | Bearer |
| GET/PUT | `/api/support/tickets` | Bearer |
| GET/POST | `/api/support/tickets/:id/comments` | Bearer |
| * | `/api/whatsapp/*` | Bearer |
| * | `/api/crm/customer-journeys*` | Bearer |
| GET | `/api/audit-logs` | Bearer + admin |
| GET | `/api/reports/shipment/download` | Bearer |
| GET | `/api/health` | Bearer |

---

*Generated from the Fiberise CRM `app/api` route handlers. If request/response shapes drift, treat the route source as source of truth.*
