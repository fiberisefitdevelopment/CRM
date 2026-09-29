# Fiberise CRM — Mobile API (complete reference)

Single shareable API contract for **both** mobile apps integrating with the Fiberise CRM backend:

| App | Roles | Jump to |
|-----|-------|---------|
| **Customer care executive** | `care_executive`, `support` | [§ Care executive app](#customer-care-executive-mobile-app) |
| **Admin / operations** | `admin`, `super_admin` | [§ Admin app](#admin--operations-mobile-app) |

**Base URL:** `https://<your-crm-host>` (Next.js origin)  
**Format:** JSON (`Content-Type: application/json`)  
**Auth:** `Authorization: Bearer <accessToken>` on all protected routes (except public auth routes)

**Table of contents**

1. [Overview & two-app matrix](#overview--two-app-matrix)
2. [Shared: quick start, auth, conventions](#shared-quick-start-auth-conventions)
3. [Customer care executive mobile app](#customer-care-executive-mobile-app)
4. [Admin & operations mobile app](#admin--operations-mobile-app)
5. [Orders, logistics & integrations (admin)](#orders-logistics--integrations-admin)
6. [Do not call from mobile](#do-not-call-from-mobile)
7. [Error reference & checklists](#error-reference--checklists)
8. [Full endpoint index](#appendix--endpoint-index)

---

## Overview & two-app matrix

### Shared basics

| Item | Value |
|------|--------|
| Base URL | `https://<crm-host>` (Next.js origin) |
| Format | JSON, `Content-Type: application/json` |
| Protected routes | `Authorization: Bearer <accessToken>` |
| Access token TTL | 1 hour (`expiresIn: 3600`) |
| Refresh token TTL | 30 days, **rotated** on every refresh |
| Public auth | `POST /api/auth/login`, `refresh`, `logout`; `GET /api/auth/me` |

#### Session flow (both apps)

```text
POST /api/auth/login     → store accessToken + refreshToken + user
Protected API call       → Bearer accessToken
HTTP 401                 → POST /api/auth/refresh → replace BOTH tokens → retry once
Logout                   → POST /api/auth/logout { refreshToken } or { allDevices: true }
```

Send `deviceId`, `deviceName`, and `platform` (`ios` | `android`) on login and refresh for session audit.

---

### Role gates (critical)

#### Care executive app

- **Must** send `"requiredRole": "care_executive"` on login and refresh.
- Server rejects other roles with `403` and a care-specific message.
- Also validate client-side: `role === 'care_executive' || role === 'support'`.

#### Admin app

- **Do not** send `requiredRole: "admin"` unless the account is exactly `admin` — `super_admin` would fail an exact match.
- Recommended: login **without** `requiredRole`, then reject locally unless `role === 'admin' || role === 'super_admin'`.
- Care executives must **not** use the admin app (hide features / force logout if role is care-only).

#### Roles that are neither app

| Role | Mobile guidance |
|------|-----------------|
| `employee` | Web CRM; some care APIs allow this role but there is no dedicated mobile contract |
| Other | No mobile app |

---

### Capability matrix

| Area | Care executive app | Admin app |
|------|-------------------|-----------|
| Care task inbox | Own queue only | All executives; `?assignee=` filter |
| Task actions | Assigned tasks only | Any task |
| Delivered / upsell / create order | Own scope + shared catalog | All orders; filter by `assignee` |
| Created orders | Own `care:<email>` tags only | All care-created orders |
| Assign executive to order | — | `GET/POST /api/care-tasks/assign-order` |
| Executive performance | — | `GET /api/care-tasks/performance` |
| Task generate / sync | — | `POST …/generate`, `…/sync-calls` |
| Device call recordings | Phone/order linked to **their** tasks | Any phone/order |
| Salestrail call log | Yes | Yes + dashboard/analytics |
| Shopify orders hub | Use `order-context` only | Full `/api/shopify/orders*` |
| Logistics (Shiprocket / Air Express) | — | Yes |
| WhatsApp / CRM journeys | — | Yes |
| Audit logs | — | `admin` / `super_admin` only |
| User registration | — | `POST /api/auth/register` |

---

### Which document to implement

1. **Building the care executive app** → start with § Care executive app (screen → API map, payloads, checklist).
2. **Building the admin app** → start with § Admin app.
3. **Lookup a route not covered in the panel doc** → this document appendix.

Route handlers under `app/api/` remain the source of truth if a field drifts.

---

### Health check

```http
GET /api/health
Authorization: Bearer <accessToken>
```

```json
{ "status": "OK", "message": "…" }
```

Use after deploy or to verify connectivity before login.

---

## Shared: quick start, auth, conventions

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

The care-executive mobile app **must** send `"requiredRole": "care_executive"`. Wrong-role accounts receive `403` and no tokens. See § Care executive app.

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


---

## Customer care executive mobile app

API contract for the care executive iOS/Android app (task inbox, delivered orders, create order, calls).

### 1. Role-based login (required)

This app is **only** for customer care executives.

Canonical role: **`care_executive`**  
Legacy alias still accepted by the server: **`support`**

Admin / employee / other CRM accounts must **not** enter the app, even if their password is valid.

#### Server gate

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

#### Client gate (also required)

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

### 2. Auth headers & token lifecycle

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Cookies are not used. Do not send session cookies.

| Token | Store in | Lifetime |
|-------|----------|----------|
| `accessToken` | Memory or encrypted store | **1 hour** (`expiresIn` seconds) |
| `refreshToken` | Keychain / Keystore | **30 days**, **rotated** on every refresh |

#### Refresh flow

```
API 401
  → POST /api/auth/refresh { refreshToken, requiredRole: "care_executive", deviceId, platform }
  → replace BOTH tokens
  → retry original request once
  → if refresh 401/403 → clear session → login
```

Refresh tokens rotate: the previous refresh token is invalid after a successful refresh. Single-flight refreshes (one in-flight refresh; queue other 401s).

#### Device metadata (send on login + refresh)

| Field | Type | Values |
|-------|------|--------|
| `deviceId` | string | Stable UUID for this install |
| `deviceName` | string | e.g. `"Pixel 8"` |
| `platform` | string | `"ios"` \| `"android"` |

#### Rate limits (login & refresh)

8 failures / 15 minutes per IP + identity, then locked 15 minutes → `429` + `retryAfterSec`.

---

### 3. Who sees what

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

### 4. Screen → API map

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

### 5. Conventions

#### Success

JSON objects. Lists often include `page`, `pageSize`, `total`, `totalPages`. Entities are wrapped (`{ "task": … }`, `{ "orders": […] }`).

#### Errors

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

#### Dates

ISO-8601 (`2026-08-17T09:30:00.000Z`). Customer-service `from`/`to` also accept date-only strings.

#### Pagination

Default `page=1`. Care lists default `pageSize=20` (max 100 on delivered / created-orders).

---

### 6. Auth endpoints

#### `POST /api/auth/login`

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

#### `POST /api/auth/refresh`

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

#### `POST /api/auth/logout`

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

#### `GET /api/auth/me`

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

### 7. Care tasks

#### Task object (`CareTask`)

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

#### Kind tabs (`kind`)

| `kind` | Meaning |
|--------|---------|
| `all` | Default |
| `cod_confirmation` | COD confirmation |
| `introduction` | Intro call |
| `day_3` / `day_5` / `day_15` / `day_23` / `day_30` / `day_60` / `day_90` | Follow-ups (`day_28` aliases to `day_23`) |
| `upsell` | Manual / pack upsell call |
| `other` | Everything else |

#### Status buckets (`status`)

| `status` | Meaning |
|----------|---------|
| `inbox` | **Default** — actionable queue |
| `today` | Due today |
| `upcoming` | Future |
| `overdue` | Past due |
| `pending` / `completed` / `rescheduled` / `escalated` / `unreachable` / `not_interested` | Exact status |
| `all` | No status filter |

#### Order group (`CareOrderGroup`) when `groupBy=order`

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

#### `GET /api/care-tasks`

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

#### `GET /api/care-tasks/summary`

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

#### `GET /api/care-tasks/:id`

**Response:** `{ "task": { /* CareTask */ } }`  
**Errors:** `403` not assigned to you · `404`

---

#### `PATCH /api/care-tasks/:id`

Workflow action. Always send **`action`** (do not rely on `status` alone).

##### Actions

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

#### `POST /api/care-tasks/:id/notes`

```json
{ "text": "Spoke to spouse; will call back" }
```

(`note` is accepted as an alias for `text`.)

**Response:** `{ "task": { … }, "note": { "id", "text", "authorEmail", "authorName", "createdAt" } }`

---

#### `GET /api/care-tasks/escalation-targets`

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

### 8. Order workspace

Same data the web order page uses: shipment snapshot, clone trail, activity, customer address.

#### `GET /api/care-tasks/order-context`

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

#### `GET /api/care-tasks/activity`

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

### 9. Delivered orders & upsell

Mirrors **Delivered Orders** in the web panel. Executives only see orders assigned to them (including a stable virtual split when no assignment is stored yet).

#### `GET /api/care-tasks/delivered-orders`

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

#### `POST /api/care-tasks/upsell`

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

### 10. Create order

Mirrors **Create Order**. Creates a live Shopify order (draft → complete) tagged `care-created` + `care:<executive-email>`.

#### `GET /api/care-tasks/shopify-products`

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

#### `POST /api/care-tasks/shopify-create-order`

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

### 11. Care-created orders

Mirrors **Created Orders**. Executives only see orders they created (`care:<email>` tag). `mine=1` is implied for this role.

#### `GET /api/care-tasks/created-orders`

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

### 12. Calls & recordings

Salestrail-backed history. Default range: **last 30 days**. Upstream can take up to ~60s — use a long timeout.

Care executives may call these routes. Filter by the executive’s phone / name with `user` or `phone` when you only want their dials.

#### `GET /api/customer-service/calls`

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

#### `GET /api/customer-service/calls/:callId/recording`

| Query | Behavior |
|-------|----------|
| `mode=url` | **Preferred on mobile** — `{ "url": "<temporary blob URL>" }` |
| `mode=proxy` (default) | Stream audio bytes through the CRM (`audio/*`, Range supported) |
| `mode=redirect` | `302` to temporary URL |
| `download=1` | Attachment filename |

**404** `{ "error": "Recording not available." }`

---

#### Device recordings (care mobile dialer)

Recordings uploaded from the executive dialer app (Firebase Storage). Access is limited to phones/orders linked to **your** care tasks (admins see all — § Admin app).

##### `GET /api/care-tasks/device-recordings`

**Query:** `phone` and/or `orderId` (at least one)

**Response:** `{ "recordings": [ /* DeviceCallRecording[] */ ] }`

##### `GET /api/care-tasks/device-recordings/:id`

Same `mode` / `download` behavior as Salestrail recordings (`url` preferred on mobile).

---

Optional (same auth; usually web-only):

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/customer-service/dashboard?from=&to=` | `{ summary, recentCalls, charts }` |
| `GET` | `/api/customer-service/analytics?from=&to=` | Analytics |
| `GET` | `/api/customer-service/calls/csv` | CSV export |
| `GET` | `/api/customer-service/integration` | Integration logs |

---

### 13. Push (optional)

#### `POST /api/register-token`

Register FCM after login.

```json
{ "token": "<fcm-device-token>" }
```

---

### 14. Do not call from this app

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

### 15. Error reference

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

### 16. Integration checklist

#### Auth

- [ ] Always send `requiredRole: "care_executive"` on login **and** refresh
- [ ] Also reject locally unless `role` is `care_executive` or `support`
- [ ] Persist `refreshToken` in Keychain / Keystore
- [ ] Persist `user.role`, `user.email`, `user.name`, `user.id`
- [ ] Send `platform` + stable `deviceId`
- [ ] On `401`, single-flight refresh, replace **both** tokens
- [ ] Timeouts: calls + order-context `live=1` can exceed 30s

#### Inbox

- [ ] `GET /api/care-tasks?status=inbox&groupBy=order`
- [ ] Summary chips from `GET /api/care-tasks/summary`
- [ ] Open workspace with `orderId` + `focusTaskId`

#### Workspace

- [ ] Load context (`order-context`) + activity + task detail
- [ ] COD: Confirm / Cancel Requested
- [ ] Other tasks: Complete (rating 1–5), Unreachable, Call After (≤ 3 days), Not interested, Escalate
- [ ] Notes

#### Other tabs

- [ ] Delivered orders + create upsell
- [ ] Product search + create order (COD / prepaid)
- [ ] Created-orders list
- [ ] Optional: call history + `mode=url` recordings
- [ ] Optional: FCM `register-token`

#### Pseudocode

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

### 17. Endpoint index

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
| GET | `/api/care-tasks/device-recordings` | Bearer + care | Yes |
| GET | `/api/care-tasks/device-recordings/:id` | Bearer + care | Yes |
| POST | `/api/register-token` | Bearer | Optional |

---

*Source of truth: `app/api/auth/*` and `app/api/care-tasks/*` route handlers. If a shape drifts, trust the route.*

---

## Admin & operations mobile app

### 1. Role-based access

#### Allowed roles

| Role | Admin mobile app |
|------|------------------|
| `admin` | Yes |
| `super_admin` | Yes |
| `care_executive` / `support` | **No** — use the care app |
| `employee` | **No** dedicated contract |

#### Login gate (recommended)

Unlike the care app, the server does **not** treat `requiredRole: "admin"` as “any admin role”. `roleSatisfiesRequired` only expands `care_executive` → `support`. For `requiredRole: "admin"`, `super_admin` accounts receive `403`.

**Recommended pattern:**

1. `POST /api/auth/login` **without** `requiredRole`.
2. After login, refresh, and `GET /api/auth/me`, enforce:

```ts
function isAdminAppRole(role?: string | null) {
  return role === 'admin' || role === 'super_admin'
}

if (!isAdminAppRole(user.role)) {
  clearTokens()
  throw new Error('Your account does not have access to this app.')
}
```

Optional hardening: send `requiredRole` only when you know the account is exactly `admin` (not `super_admin`).

#### Admin vs care on care APIs

| Capability | Admin | Care executive |
|------------|-------|----------------|
| List tasks | All queues; optional `?assignee=email` | Own queue only (`assignee` ignored) |
| GET/PATCH task | Any task | Assigned tasks only |
| `GET …/summary` | Global or `?assignee=` | Own counts only |
| `GET …/delivered-orders` | All; `?assignee=` | Own (virtual split when unassigned) |
| `GET …/created-orders` | All care-created (omit `mine=1`) | `mine=1` implied |
| `assign-order`, `performance` | Yes | `403` |
| Device recordings | Any phone/order | Only if linked to their tasks |

---

### 2. Auth & session

Same token model as the care app. See § Overview.

#### `POST /api/auth/login`

**Auth:** Public

```json
{
  "email": "admin@fiberisefit.com",
  "password": "secret",
  "deviceId": "stable-device-uuid",
  "deviceName": "iPhone 15",
  "platform": "ios"
}
```

**Response `200`:** `{ success, accessToken, refreshToken, expiresIn, user: { id, name, email, role } }`

**Errors:** `400`, `401`, `429`, `500`

#### `POST /api/auth/refresh`

**Body:** `{ "refreshToken": "…", "deviceId?", "deviceName?", "platform?" }`  
**Response:** Same as login. Replace **both** tokens after every refresh.

#### `POST /api/auth/logout`

This device: `{ "refreshToken": "…" }`  
All devices: `{ "allDevices": true }` (+ Bearer or refresh token)

#### `GET /api/auth/me`

Bearer required. Use on cold start; reject non-admin roles.

#### `POST /api/auth/register`

**Auth:** Bearer + `admin` or `super_admin` only

```json
{
  "email": "newuser@example.com",
  "password": "min 6 chars",
  "name": "Optional",
  "role": "care_executive"
}
```

**Response `201`:** `{ "success": true, "message": "…", "userId": "…" }`

---

### 3. Screen → API map

Maps web CRM areas to APIs for mobile navigation design.

| Web area | Primary APIs |
|----------|----------------|
| Care tasks (all executives) | `GET /api/care-tasks?groupBy=order&assignee=`, `GET /api/care-tasks/summary?assignee=` |
| Care order workspace | `GET /api/care-tasks/:id`, `PATCH …`, `POST …/notes`, `GET /api/care-tasks/order-context`, `GET /api/care-tasks/activity` |
| Assign executive | `GET/POST /api/care-tasks/assign-order` |
| Care performance | `GET /api/care-tasks/performance` |
| Delivered orders | `GET /api/care-tasks/delivered-orders?assignee=` |
| Created orders (all) | `GET /api/care-tasks/created-orders` (no `mine=1`) |
| Create order (care flow) | `GET /api/care-tasks/shopify-products`, `POST /api/care-tasks/shopify-create-order` |
| Sync / generate tasks | `POST /api/care-tasks/generate`, `POST /api/care-tasks/sync-calls` |
| Customer service dashboard | `GET /api/customer-service/dashboard` |
| Call history / recordings | `GET /api/customer-service/calls`, `GET …/calls/:callId/recording` |
| Device recordings (app dialer) | `GET /api/care-tasks/device-recordings`, `GET …/device-recordings/:id` |
| CS analytics / integration | `GET /api/customer-service/analytics`, `GET /api/customer-service/integration` |
| Orders list / detail | `GET /api/shopify/orders`, `GET/PATCH/PUT/DELETE /api/shopify/orders/:id` |
| Order status / tracking | `GET /api/shopify/orders?view=order_status`, `GET /api/order-status/track?awb=` |
| Shiprocket actions | `/api/shiprocket/*` |
| Air Express | `/api/air-express/*` |
| WhatsApp | `/api/whatsapp/*` |
| CRM customer journeys | `/api/crm/customer-journeys*` |
| Support tickets | `/api/support/tickets*` |
| Audit logs | `GET /api/audit-logs` |
| Shipment report PDF | `GET /api/reports/shipment/download` |
| Sales / pincode analytics | `GET /api/shopify/product-sales`, `GET /api/shopify/pincode-analytics`, zone/gender analytics |
| Notifications | `POST /api/register-token`, `POST /api/send-all`, `POST /api/broadcast-personalized` |

Task list/query parameters, `CareTask` shape, and PATCH actions are identical to the care contract — see § Customer care executive app. Admin differences are filters and assignment APIs below.

---

### 4. Care supervision (admin extras)

#### `GET /api/care-tasks/assign-order`

List active care executives for reassignment UI.

**Response**

```json
{
  "executives": [
    { "userId": "…", "email": "shubham.kumar@fiberisefit.com", "name": "Shubham" }
  ]
}
```

**Errors:** `403` if not admin

---

#### `POST /api/care-tasks/assign-order`

Persist care executive ownership for an order (updates assignment store + open tasks).

**Body**

```json
{
  "orderId": "1234567890",
  "orderName": "#1234",
  "email": "shubham.kumar@fiberisefit.com",
  "phone": "+9198…"
}
```

| Field | Required |
|-------|----------|
| `orderId` | Yes |
| `email` | Yes (executive account email) |
| `orderName`, `phone` | Optional but recommended |

**Response**

```json
{
  "success": true,
  "tasksUpdated": 3,
  "assignment": {
    "orderId": "1234567890",
    "orderName": "#1234",
    "email": "shubham.kumar@fiberisefit.com",
    "name": "Shubham",
    "label": "Shubham",
    "updatedAt": "2026-08-17T06:00:00.000Z"
  }
}
```

---

#### `GET /api/care-tasks/performance`

Per-executive KPIs for supervision dashboards.

**Response**

```json
{
  "executives": [
    {
      "email": "shubham.kumar@fiberisefit.com",
      "name": "Shubham",
      "assigned": 120,
      "completed": 80,
      "pending": 25,
      "overdue": 5,
      "callsMade": 200,
      "avgCompletionHours": 4.2,
      "completionPct": 66,
      "lastActivity": "2026-08-17T09:00:00.000Z"
    }
  ]
}
```

---

#### `POST /api/care-tasks/generate`

Rebuild care tasks from the in-memory orders cache. Pulls recent Shopify orders first (default).

**Body**

```json
{
  "maxOrders": 200,
  "refresh": true,
  "redistribute": false,
  "forceEven": false
}
```

| Field | Default | Notes |
|-------|---------|--------|
| `refresh` | `true` | Pull latest Shopify orders into cache |
| `redistribute` | `false` | When `true`, rebalance open tasks across executives |
| `forceEven` | `false` | Used with `redistribute` |

**Response `200`**

```json
{
  "success": true,
  "cacheSize": 5000,
  "shopifyPulled": 80,
  "tasksRedistributed": 0,
  "result": { /* generator stats */ }
}
```

**Errors:** `409` if orders cache empty · `403` if role cannot access care APIs

---

#### `POST /api/care-tasks/sync-calls`

Attach Salestrail calls to tasks (default lookback **48 hours**).

**Body:** `{ "hoursBack": 48 }`

**Response:** `{ "success": true, … }` (see route for sync counts)

---

#### Assignee query param

On these routes, admins may filter by executive email:

| Route | Query |
|-------|--------|
| `GET /api/care-tasks` | `assignee=shubham.kumar@fiberisefit.com` |
| `GET /api/care-tasks/summary` | `assignee=…` |
| `GET /api/care-tasks/delivered-orders` | `assignee=…` |

Omit `assignee` to see **all** executives (aggregated queues / lists).

---

### 5. Care tasks (shared with web)

Implement using § Customer care executive app:

- §7 — `GET /api/care-tasks`, summary, `GET/PATCH /api/care-tasks/:id`, notes, escalation targets
- §8 — `order-context`, `activity`
- §9 — `delivered-orders`, `POST /api/care-tasks/upsell`
- §10–11 — create order, `created-orders` (admin: do **not** force `mine=1`)

**Admin-only behavior:** any task ID is readable/updatable; use `assignee` filters on lists.

---

### 6. Customer service & calls

Full Salestrail integration (not scoped to one executive). Default date range: **last 30 days**. Upstream may take **up to ~60s** — use generous timeouts.

#### `GET /api/customer-service/calls`

Same query surface as [§ Calls & recordings](#calls--recordings) above: `from`, `to`, `page`, `pageSize`, `search`, `user`, `phone`, `answered`, `direction`, `hasRecording`, `includeSummary`, etc.

#### `GET /api/customer-service/calls/:callId/recording`

| `mode` | Use |
|--------|-----|
| `url` | Mobile player — `{ "url": "…" }` |
| `proxy` | Stream through CRM |
| `redirect` | `302` to blob URL |

#### `GET /api/customer-service/dashboard?from=&to=`

```json
{
  "summary": { /* call aggregates */ },
  "recentCalls": [ /* last 20 */ ],
  "kpis": { /* … */ },
  "charts": {
    "callsPerDay": [],
    "answeredVsMissed": [],
    "inboundVsOutbound": [],
    "averageDurationTrend": [],
    "topUsers": [],
    "hourlyDistribution": [],
    "durationHistogram": []
  }
}
```

#### `GET /api/customer-service/analytics?from=&to=`

Full analytics payload for the analytics screen.

#### `GET /api/customer-service/integration`

Integration logs: `from`, `to`, `page`, `pageSize`, `search`, `status`, `user`

#### `GET /api/customer-service/calls/csv`

Same filters as list; CSV download (export action).

---

#### Device recordings (mobile dialer uploads)

Firestore-backed recordings from the care mobile dialer — **admins can query any phone/order**.

##### `GET /api/care-tasks/device-recordings`

**Query:** `phone` and/or `orderId` (at least one required)

**Response**

```json
{
  "recordings": [
    {
      "id": "cs_call_…",
      "callLogId": "…",
      "phone": "9198…",
      "customerName": "Asha",
      "direction": "outbound",
      "durationSec": 120,
      "hasRecording": true,
      "orderId": "123",
      "orderName": "#1234",
      "startTime": "2026-08-17T08:00:00.000Z",
      "userName": "Shubham",
      "userEmail": "shubham.kumar@fiberisefit.com"
    }
  ]
}
```

##### `GET /api/care-tasks/device-recordings/:id`

| Query | Behavior |
|-------|----------|
| `mode=url` | `{ "url": "<signed Storage URL>" }` |
| `mode=proxy` (default) | Stream audio |
| `mode=redirect` | `302` |
| `download=1` | Attachment |

---

### 7. Orders & order status

#### `GET /api/shopify/orders`

Primary orders hub. Not for care executives on mobile — admins use this for list/filter/detail.

| Param | Notes |
|-------|--------|
| `page`, `per_page` | `per_page` max 100 |
| `all=true` | Full fetch (heavy) |
| `refresh=true` | Refresh cache |
| `view=order_status` | Order-status shaped rows |
| `tab`, `search` | UI tabs / search |
| `financial`, `payment`, `channel`, `courier`, `pickup`, `weight`, `rto` | Filters |
| `min_price`, `max_price` | |
| `date_preset`, `start_date`, `end_date` | |
| `fulfillment`, `delivery`, `payment_status` | |
| `include_test` | Include test orders |

**Response (high level):** `{ orders, pagination, tabCounts, isOffline, syncing, … }`

#### `GET /api/shopify/orders/:id`

`{ "order": { … } }`

#### `PATCH /api/shopify/orders/:id`

```json
{ "is_test_order": true }
```

#### `PUT /api/shopify/orders/:id`

```json
{ "note": "Internal note" }
```

#### `DELETE /api/shopify/orders/:id`

Cancel single order.

#### `DELETE /api/shopify/orders`

```json
{ "ids": ["123", "456"] }
```

Bulk cancel.

#### `GET /api/shopify/orders/latest`

Lightweight poll for newest orders (see route for query params).

#### `GET /api/order-status/track?awb=<AWB>`

Shiprocket tracking by AWB. **400** if `awb` missing.

---

### 8. Logistics

Credentials stay server-side. Request/response bodies mirror Shiprocket / Air Express external APIs.

#### Shiprocket (common)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/shiprocket/create-order` | Create adhoc shipment |
| `POST` | `/api/shiprocket/ship-confirmed-order` | Ship confirmed Shopify order |
| `GET` | `/api/shiprocket/courier-serviceability?orderId=` | Courier options |
| `POST` | `/api/shiprocket/manifest` | `{ orderNames?, shipmentIds? }` → `manifestUrl` |
| `POST` | `/api/shiprocket/label` | Label URL |
| `POST` | `/api/shiprocket/invoice` | Invoice URL |

#### Air Express

| Method | Path | Purpose |
|--------|------|---------|
| `GET/POST` | `/api/air-express/orders` | List / create |
| `GET` | `/api/air-express/orders/[orderId]` | Detail |
| `POST` | `/api/air-express/orders/create`, `bulk-upload`, `cancel`, `update*` | Order lifecycle |
| `GET/POST` | `/api/air-express/shipments` | Shipments |
| `GET` | `/api/air-express/courier-options?orderId=` | Couriers |
| `POST` | `/api/air-express/ship-confirmed-order` | Ship from Shopify |
| `GET` | `/api/air-express/track/*` | AWB / shipment / order tracking |
| `POST` | `/api/air-express/documents/labels`, `invoices`, `manifests` | Document URLs |

See this document and `app/api/air-express/**` for field-level payloads.

#### Shipway (legacy paths)

`/api/shipway/track`, `/api/shipway/manifest`, `/api/shipway/courier-options`, `/api/shipway/ship-confirmed-order` — use if the web UI still exposes them for your workflow.

---

### 9. WhatsApp & CRM journeys

Admin / ops tooling. Bearer required.

#### WhatsApp

| Method | Path | Purpose |
|--------|------|---------|
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/whatsapp/templates` | Template CRUD (`DELETE` → `?id=`) |
| `POST` | `/api/whatsapp/templates/seed` | Seed defaults |
| `GET` / `PATCH` | `/api/whatsapp/journeys` | List; pause/resume (`journeyId`, `status`) |
| `GET` / `POST` | `/api/whatsapp/logs` | List; retry `{ logId }` |
| `GET` | `/api/whatsapp/analytics` | Analytics |
| `GET` / `POST` | `/api/whatsapp/scheduler` | Status / manual tick |

#### CRM customer journeys

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/crm/customer-journeys` | `search`, `stage`, `status`, dates, `page`, `limit` |
| `GET` | `/api/crm/customer-journeys/analytics` | Analytics |
| `GET` | `/api/crm/customer-journeys/:id` | Journey + logs |
| `POST` | `/api/crm/customer-journeys/:id` | `{ "action": "retry" \| "trigger", "stage?": "…" }` |

---

### 10. Support tickets

Proxied to Wellness API.

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/support/tickets?limit=&status=` | List |
| `PUT` | `/api/support/tickets` | Body must include `id` |
| `GET` | `/api/support/tickets/:id/comments?limit=` | Comments |
| `POST` | `/api/support/tickets/:id/comments` | `{ "message", "authorType?" }` |

---

### 11. Analytics & reports

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/shopify/product-sales` | Sales dashboard |
| `GET` | `/api/shopify/zone-analytics` | Zone breakdown |
| `GET` | `/api/shopify/gender-analytics?refresh=true` | Gender analytics |
| `GET` | `/api/shopify/pincode-analytics` | `pincodes`, `city`, `state`, `zone` |
| `GET` | `/api/analytics/rto-by-pincode` | RTO by pincode |
| `GET` | `/api/reports/shipment/download` | PDF; `startDate`, `endDate` |

---

### 12. Governance & push

#### `GET /api/audit-logs`

**Auth:** `admin` or `super_admin` only (strict `requireRole`).

| Query | Notes |
|-------|--------|
| `page`, `per_page` | Default page 1, per_page 25 (max 100) |
| `action_type`, `module`, `user`, `status`, `search` | Filters |
| `start_date`, `end_date`, `ip` | Date / IP filters |

**Response**

```json
{
  "success": true,
  "logs": [ /* audit rows */ ],
  "pagination": { "page": 1, "per_page": 25, "total": 100, "total_pages": 4 }
}
```

#### FCM

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/register-token` | `{ "token": "<fcm>" }` |
| `POST` | `/api/send` | `{ token, title, body, data? }` |
| `POST` | `/api/send-all` | `{ title, body, data? }` |
| `POST` | `/api/broadcast-personalized` | `batchSize?`, `useRecommendedCategory?` |

---

### 13. Do not call from mobile

| Path | Reason |
|------|--------|
| `/api/webhooks/*` | Shopify HMAC |
| `/api/cron/*` | Schedulers (no JWT) |
| `GET /api/debug/shiprocket-order` | Debug |

---

### 14. Error reference

| Status | Typical body | Action |
|--------|--------------|--------|
| `401` | `{ "error": "Unauthorized" }` | Refresh once; else login |
| `403` | `{ "error": "Forbidden" }` | Wrong role or audit route |
| `404` | `{ "error": "Not found" }` | Refresh UI |
| `409` | e.g. empty orders cache on generate | Run order sync / fix Shopify creds |
| `429` | `{ "error", "retryAfterSec" }` | Back off |
| `500` / `502` | `{ "error" }` | Retry; show generic error |

---

### 15. Integration checklist

#### Auth

- [ ] Client-side `isAdminAppRole` after login / refresh / `me`
- [ ] Do **not** use `requiredRole: "admin"` for `super_admin` accounts
- [ ] Secure storage for refresh token; single-flight refresh
- [ ] `deviceId` + `platform` on login/refresh

#### Care supervision

- [ ] Executive picker from `GET /api/care-tasks/assign-order`
- [ ] Reassign via `POST /api/care-tasks/assign-order`
- [ ] Inbox with `groupBy=order` and optional `assignee`
- [ ] Performance tab from `GET /api/care-tasks/performance`
- [ ] Ops: `POST /api/care-tasks/generate` (+ `redistribute` when needed)

#### Operations

- [ ] Orders hub `GET /api/shopify/orders` with `refresh` when stale
- [ ] Order detail + cancel/note actions
- [ ] CS dashboard + call list + recordings (Salestrail + device)
- [ ] Audit logs for superuser actions
- [ ] Long timeouts (30–120s) on orders list, calls, generate

---

### 16. Endpoint index (admin-focused)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public |
| POST | `/api/auth/logout` | Public |
| GET | `/api/auth/me` | Bearer |
| POST | `/api/auth/register` | Admin only |
| GET | `/api/care-tasks` | `assignee?` |
| GET | `/api/care-tasks/summary` | `assignee?` |
| GET/PATCH | `/api/care-tasks/:id` | Any task |
| POST | `/api/care-tasks/:id/notes` | |
| GET | `/api/care-tasks/order-context` | |
| GET | `/api/care-tasks/activity` | |
| GET | `/api/care-tasks/escalation-targets` | |
| GET/POST | `/api/care-tasks/assign-order` | Admin only |
| GET | `/api/care-tasks/performance` | Admin only |
| POST | `/api/care-tasks/generate` | |
| POST | `/api/care-tasks/sync-calls` | |
| GET | `/api/care-tasks/delivered-orders` | `assignee?` |
| POST | `/api/care-tasks/upsell` | |
| GET | `/api/care-tasks/created-orders` | All executives |
| GET/POST | `/api/care-tasks/shopify-products`, `shopify-create-order` | |
| GET | `/api/care-tasks/device-recordings` | |
| GET | `/api/care-tasks/device-recordings/:id` | |
| GET | `/api/customer-service/*` | Full CS suite |
| GET/PATCH/PUT/DELETE | `/api/shopify/orders*` | |
| GET | `/api/order-status/track` | |
| POST | `/api/shiprocket/*` | |
| * | `/api/air-express/*` | |
| * | `/api/whatsapp/*` | |
| * | `/api/crm/customer-journeys*` | |
| GET/PUT | `/api/support/tickets*` | |
| GET | `/api/audit-logs` | Admin only |
| GET | `/api/reports/shipment/download` | PDF |
| GET | `/api/shopify/product-sales`, analytics routes | |
| POST | `/api/register-token`, `/api/send-all` | |
| GET | `/api/health` | |

---

*Source of truth: `app/api/**` route handlers. Shared care payloads: § Customer care executive app.*

---

## Orders, logistics & integrations (admin)

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


---

##  Do not call from mobile

These exist for Shopify / schedulers / debugging. Do **not** expose or call from the app:

| Path | Reason |
|------|--------|
| `POST /api/webhooks/shopify/order-created` | Shopify HMAC webhook |
| `GET`/`POST` `/api/cron/*` | Internal schedulers (no JWT) |
| `GET /api/debug/shiprocket-order` | Debug dump |

---


---

## Error reference & checklists

### Error reference

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

### Mobile integration checklist

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