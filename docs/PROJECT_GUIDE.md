# Fiberise Fit CRM — Project Guide

A single reference for **what** this system does, **when** things run, **how** they are wired, and **why** each piece exists.

> **Related:** For mobile client API contracts, see [MOBILE_API.md](./MOBILE_API.md). For the **customer care executive** mobile app, see [CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md).

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Tech stack](#2-tech-stack)
3. [High-level architecture](#3-high-level-architecture)
4. [Repository layout](#4-repository-layout)
5. [Environment variables](#5-environment-variables)
6. [Authentication & roles](#6-authentication--roles)
7. [Data layer (Firestore & cache)](#7-data-layer-firestore--cache)
8. [Feature modules](#8-feature-modules)
9. [Background jobs & cron](#9-background-jobs--cron)
10. [External integrations](#10-external-integrations)
11. [API surface](#11-api-surface)
12. [Request lifecycle](#12-request-lifecycle)
13. [Running locally](#13-running-locally)
14. [Design decisions (why)](#14-design-decisions-why)

---

## 1. What this project is

**Fiberise Fit CRM** (`fiberise-dashboard`) is an internal **operations dashboard** for [Fiberise Fit](https://www.fiberisefit.com) — a wellness/fitness brand selling via Shopify.

It centralizes:

| Area | Purpose |
|------|---------|
| **Orders** | View, filter, and act on Shopify + Shiprocket orders |
| **Logistics** | Create shipments (Shiprocket, Aaysh Air Express), track AWBs, print labels/manifests |
| **Customer care** | Post-delivery follow-up tasks, call history (Salestrail), recordings |
| **Engagement** | WhatsApp post-delivery journeys (AiSensy), push notifications (FCM) |
| **Analytics** | Sales dashboards, zone/pincode/gender breakdowns, shipment reports |
| **Governance** | JWT auth, role-based access, audit logs |

The app is a **Next.js 16** full-stack application: React UI in `app/`, business logic in `src/services/`, and ~74 REST API routes under `app/api/`.

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS, CSS variables for light/dark theme |
| Primary database | **Firebase Firestore** (via Admin SDK server-side, client SDK in browser) |
| Legacy / optional | MongoDB (`MONGO_URI`) — used by older FCM token paths |
| Auth | JWT (access 1h + refresh 30d) via `jose`, stored in `localStorage` |
| Maps | Mapbox GL (`react-map-gl`) |
| Charts | Recharts, Chart.js |
| PDF / reports | Puppeteer, `chartjs-node-canvas`, `pptxgenjs` |
| Email | Nodemailer (Brevo SMTP) |
| Scheduling | `node-cron` (optional in-process) + HTTP cron routes |
| HTTP clients | `fetch`, `axios` |

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (React UI)                              │
│  app/* pages  ·  components/*  ·  hooks/*  ·  lib/auth (JWT client)   │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ apiFetch + Bearer token
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Next.js Middleware (middleware.ts)                    │
│  Validates JWT on /api/* (except public auth, webhooks, cron)           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      API Routes (app/api/**/route.ts)                    │
│  Thin handlers → src/services/*                                         │
└───────┬─────────────┬─────────────┬─────────────┬───────────────────────┘
        ▼             ▼             ▼             ▼
   Firestore     Shopify API   Shiprocket API   Aaysh Express API
                 Salestrail     AiSensy          Firebase FCM
```

### Data flow examples

**Order placed (Shopify webhook)**

```
Shopify orders/create webhook
  → POST /api/webhooks/shopify/order-created (HMAC verify)
  → journey.service.createJourneyFromOrder()
  → Firestore: customers, journeys
  → AiSensy: Day 0 welcome WhatsApp (async)
```

**Order delivered (sync + journey cron)**

```
Orders sync (Shopify + Shiprocket merge → ordersCache)
  → customerJourney.service.checkAndTriggerDeliveryJourneys()
  → Firestore: customerJourneys
  → Cron GET /api/cron/customer-journey
  → AiSensy: Day 1/3/4/5 templates on schedule
```

**Care task lifecycle**

```
Cron GET /api/cron/care-tasks (or manual trigger)
  → careTasks/scheduler.runCareTaskScheduler()
  → generator: create follow-up tasks from delivered orders
  → callLinker: attach Salestrail calls to tasks by phone
  → sweep overdue / promote rescheduled tasks
  → Firestore: careTasks, careTaskLogs
```

---

## 4. Repository layout

```
CRM/
├── app/                    # Next.js App Router — pages & API routes
│   ├── page.tsx            # Health monitoring dashboard (home)
│   ├── layout.tsx          # Root layout, AuthProvider, theme script
│   ├── login/              # Login page
│   ├── orders/             # Main orders hub (Shopify + Shiprocket merged)
│   ├── order-status/       # Ops tracking view with timelines & alerts
│   ├── sales-dashboard/    # Revenue & analytics charts
│   ├── customer-service/   # Call dashboard, care tasks, recordings, analytics
│   ├── crm/customer-journeys/  # CRM journey management UI
│   ├── whatsapp/           # Templates, journeys, logs, analytics
│   ├── air-express/        # Aaysh Express logistics UI
│   ├── shiprocket/         # Shiprocket order creation
│   ├── notifications/      # FCM broadcast UI
│   ├── reports/            # Shipment PDF reports
│   ├── audit-logs/         # Admin audit trail
│   ├── meta-analytics/     # Placeholder (coming soon)
│   └── api/                # REST API (see §11)
│
├── components/             # Shared React components
│   ├── layout/             # Sidebar, TopBar
│   ├── dashboard/          # Maps, charts, user tables
│   ├── customer-service/   # Call drawers, badges, sub-nav
│   ├── air-express/        # Logistics UI primitives
│   └── notifications/      # Push notification form
│
├── hooks/                  # Client data hooks (useUsers, useStats, etc.)
├── lib/                    # Client utilities
│   ├── auth/               # AuthProvider, apiFetch, tokenStore
│   ├── geocoding.ts        # Reverse geocode for user map
│   └── airExpressApi.ts    # Client wrapper for Air Express APIs
│
├── src/
│   ├── services/           # Core business logic (server-side)
│   │   ├── auth/           # JWT, guards, refresh tokens, rate limit
│   │   ├── careTasks/      # Task generation, assignment, scheduler
│   │   ├── customerService.ts   # Salestrail API client
│   │   ├── journey.service.ts   # Shopify-order WhatsApp journeys
│   │   ├── customerJourney.service.ts  # Post-delivery AiSensy journeys
│   │   ├── firestore.service.ts # WhatsApp journey CRUD
│   │   ├── ordersCache.ts  # Merged order cache (memory + .orders-cache.json)
│   │   ├── shiprocketClient.ts
│   │   ├── aayshExpressClient.ts
│   │   ├── aisensy.ts / whatsapp.service.ts
│   │   ├── notificationService.ts
│   │   ├── auditLogService.ts
│   │   └── reports/        # Report generation (PDF)
│   ├── jobs/               # node-cron schedulers (optional)
│   ├── reports/            # Report controllers
│   ├── utils/              # orderTimeline, phoneNormalize, accessControl, etc.
│   └── firebase/           # Admin SDK init
│
├── docs/
│   ├── PROJECT_GUIDE.md    # This file
│   ├── MOBILE_API.md                    # General mobile integration reference
│   └── CARE_EXECUTIVE_MOBILE_API.md     # Care-executive mobile app API
│
├── middleware.ts           # API JWT gate
├── instrumentation.ts      # Server startup hook (cron init — currently disabled)
├── .env.example            # Required env template
└── .orders-cache.json      # Disk snapshot of merged orders (gitignored in prod)
```

---

## 5. Environment variables

Copy `.env.example` to `.env` and fill in values. Grouped by purpose:

### Firebase (required)

| Variable | Why |
|----------|-----|
| `FIREBASE_PROJECT_ID` | Firestore, FCM, Admin SDK |
| `FIREBASE_CLIENT_EMAIL` | Service account |
| `FIREBASE_PRIVATE_KEY` | Service account key (escaped `\n`) |

### JWT (required in production)

| Variable | Why |
|----------|-----|
| `JWT_ACCESS_SECRET` | Signs 1-hour access tokens |
| `JWT_REFRESH_SECRET` | Signs 30-day refresh tokens (must differ from access) |

### Shopify

| Variable | Why |
|----------|-----|
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Pull orders, analytics |
| `SHOPIFY_WEBHOOK_SECRET` | Verify `orders/create` webhook HMAC |
| `NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN` | Shop hostname |
| `NEXT_PUBLIC_SHOPIFY_API_VERSION` | Admin API version (e.g. `2024-01`) |

### Shiprocket

| Variable | Why |
|----------|-----|
| `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | API auth for labels, tracking, order create |

### Aaysh Air Express

| Variable | Why |
|----------|-----|
| `AAYSH_EXPRESS_EMAIL` / `AAYSH_EXPRESS_PASSWORD` | Logistics partner API |
| `AAYSH_EXPRESS_BASE_URL` | API base (default `https://aaysh.onrender.com`) |

### WhatsApp (AiSensy)

| Variable | Why |
|----------|-----|
| `AISENSY_API_KEY` | Campaign API auth |
| `AISENSY_BASE_URL` | AiSensy endpoint |
| `AISENSY_CAMPAIGN_DAY0` … `DAY5` | Campaign names per journey day |

### Customer service (Salestrail)

| Variable | Why |
|----------|-----|
| `SALESTRAIL_API_BASE_URL` | Call export API |
| `SALESTRAIL_API_USERNAME` / `SALESTRAIL_API_PASSWORD` | Basic auth |

### Email (optional — simulator if unset)

| Variable | Why |
|----------|-----|
| `BREVO_SMTP_USER` / `BREVO_SMTP_KEY` | Transactional email via Brevo |

### Other

| Variable | Why |
|----------|-----|
| `MONGO_URI` | Legacy FCM token storage (optional) |
| `WELLNESS_API_BASE_URL` | Fiberise public site API |
| `SALESIQ_SUPPORT_SHARED_SECRET` | Zoho SalesIQ widget auth |

---

## 6. Authentication & roles

### How auth works

1. User logs in at `/login` → `POST /api/auth/login` with email/password.
2. Server validates against Firestore `users` collection (bcrypt password).
3. Returns **access token** (1h) + **refresh token** (30d, hashed in `refresh_tokens`).
4. Client stores tokens in `localStorage` (`lib/auth/tokenStore.ts`).
5. All API calls use `Authorization: Bearer <accessToken>` via `apiFetch`.
6. On 401, client auto-refreshes via `POST /api/auth/refresh` (rotating refresh tokens).
7. **Middleware** (`middleware.ts`) rejects invalid/missing tokens on protected `/api/*` routes.
8. **AuthProvider** (`lib/auth/AuthProvider.tsx`) guards pages client-side and redirects unauthenticated users to `/login`.

### Roles

| Role | Home route | Access |
|------|------------|--------|
| `super_admin` / `admin` | `/orders` | Full dashboard + audit logs |
| `employee` | `/orders` | General staff (route guards may vary) |
| `care_executive` / `support` | `/customer-service/care-tasks` | Care tasks + customer-service APIs only |

Care executives are restricted by `src/utils/accessControl.ts` — only paths under `/customer-service/care-tasks`, `/customer-service/delivered-orders`, `/customer-service/created-orders`, `/customer-service/create-order`, `/api/care-tasks`, `/api/customer-service`, and `/api/auth` are allowed.

The care-executive **mobile app** must send `requiredRole: "care_executive"` on login and refresh. Non-executive accounts get `403` and no tokens. Full contract: [CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md).

### Rate limiting

Login and refresh: **8 failures per 15 minutes** per IP + identity → `429` with `retryAfterSec`.

### Seeding

On first deploy, `src/services/auth/seed.ts` can create an initial admin user if none exists (triggered from auth routes).

---

## 7. Data layer (Firestore & cache)

### Firestore collections

| Collection | What | When written |
|------------|------|--------------|
| `users` | CRM login accounts + app users (FCM tokens, health data subcollections) | Auth seed, mobile registration |
| `refresh_tokens` | Hashed refresh token records per device/session | Login, refresh, logout |
| `careTasks` | Post-delivery follow-up tasks for care executives | Scheduler, manual generate, call linker |
| `careTaskLogs` | Audit trail for care task actions | Task updates |
| `careTaskConfig` | Follow-up schedules per product pack | Seeded on first scheduler run |
| `careOrderTags` | Tags on orders (e.g. COD confirmed) | Orders UI / API |
| `customerJourneys` | Post-delivery WhatsApp journey state (Day 0–5) | Order sync when delivered |
| `customerJourneyLogs` | Per-message send logs for journeys | Journey processor |
| `customers` | WhatsApp journey customers (phone-keyed) | Shopify webhook |
| `journeys` | Legacy/alternate journey docs | Shopify webhook flow |
| `message_templates` | WhatsApp template definitions | Admin UI / seed |
| `message_logs` | WhatsApp send history | whatsapp.service |
| `test_orders` | Flagged test orders (excluded from live journeys) | Admin |
| `audit_logs` | User action audit trail | auditLogService on sensitive actions |
| `orderNotes` | Internal notes on orders | Orders API |

### App user subcollections (mobile app data)

Under `users/{userId}/`:

- `Step_24` — daily step counts
- `healthData` — health metrics
- `meals` — meal logs

Used by the **Health Monitoring Dashboard** (`app/page.tsx`) and **personalized notifications**.

### Orders cache

`src/services/ordersCache.ts` merges **Shopify** and **Shiprocket** orders into one in-memory list:

- **TTL:** 5 minutes in memory
- **Disk:** `.orders-cache.json` snapshot (up to 24h for fast cold start)
- **Why:** Avoid hitting Shopify/Shiprocket on every page load; enable consistent filtering across modules

Sync is triggered by orders pages, report service, and care task scheduler.

---

## 8. Feature modules

### 8.1 Health Monitoring Dashboard (`/`)

**What:** Map + table of mobile app users with location, subscription status (FCM token presence), search/filter by Indian state/city.

**How:** `hooks/useUsers` reads Firestore `users`; `lib/geocoding` reverse-geocodes lat/lng via Mapbox.

**When:** On dashboard load; 2-minute client cache.

**Why:** Ops visibility into app adoption and push-notification reach by geography.

---

### 8.2 Orders (`/orders`)

**What:** Primary order operations hub — merged Shopify + Shiprocket data, filters (status, COD, RTO, delays), care tags, notes, clone orders, export.

**How:** `GET /api/shopify/orders` triggers cache sync; UI uses `ordersCache` utilities and `src/utils/orderTimeline` for status normalization.

**When:** Continuous use by ops team; cache refreshes every 5 minutes or on manual refresh.

**Why:** Single pane of glass for fulfillment, exceptions, and care tagging.

---

### 8.3 Order Status (`/order-status`)

**What:** Ops-focused tracking view — timelines, delay alerts, RTO warnings, IST date filters, quick customer contact.

**How:** Same order cache + `buildTimeline`, `buildAlerts` from `orderTimeline.ts`.

**When:** Daily ops monitoring.

**Why:** Faster triage than the full orders grid.

---

### 8.4 Sales Analytics (`/sales-dashboard`)

**What:** Revenue charts, COD vs prepaid, cancellation rates, product mix, geographic breakdowns.

**How:** Fetches Shopify orders client-side; uses Recharts. Supplementary APIs: `/api/shopify/zone-analytics`, `pincode-analytics`, `gender-analytics`.

**When:** Business review / planning.

**Why:** Sales intelligence without leaving the CRM.

---

### 8.5 Customer Service (`/customer-service/*`)

| Page | What |
|------|------|
| `/dashboard` | Call volume, answered/missed, integration health |
| `/call-history` | Searchable Salestrail call log with order enrichment |
| `/recordings` | Play/download call recordings |
| `/analytics` | Agent and call analytics |
| `/integration-logs` | Salestrail CRM integration success/failure |
| `/care-tasks` | Task queue for care executives |

**How:** `src/services/customerService.ts` wraps Salestrail Pull API. Calls are enriched with Shopify order data by phone match (`enrichCallsWithOrders.ts`).

**When:** Real-time during support shifts; recordings on demand.

**Why:** Tie phone support to order context; measure team performance.

---

### 8.6 Care Tasks (`/customer-service/care-tasks`)

**What:** Scheduled post-delivery follow-ups (Day 1, 3, 7, etc.) per product pack, assigned round-robin to care executives.

**How:**

| Component | Role |
|-----------|------|
| `generator.ts` | Creates tasks from delivered orders using `followupPlans` + `packResolver` |
| `assignmentEngine.ts` | Round-robin to users with `careExecutive: true` |
| `callLinker.ts` | Links inbound/outbound Salestrail calls to open tasks by phone |
| `scheduler.ts` | Orchestrates generate + sync + overdue sweep |
| `queries.ts` | List/filter/update tasks for UI and mobile API |

**When:**

- **Cron:** `GET /api/cron/care-tasks` (call from external scheduler, e.g. Vercel Cron, every 15–60 min)
- **Manual:** `POST /api/care-tasks/generate`, UI refresh

**Why:** Systematic wellness check-ins after delivery, with SLA tracking and call history linkage.

---

### 8.7 WhatsApp & Customer Journeys

Two related but distinct flows:

#### A. Shopify order journeys (`journey.service.ts`)

- **Trigger:** Shopify `orders/create` webhook → `/api/webhooks/shopify/order-created`
- **Storage:** `customers`, `journeys`, `message_logs`
- **Send:** Day 0 confirmation via `whatsapp.service` / AiSensy
- **Schedule:** Optional in-process cron (`journeyScheduler.ts`) — **currently disabled** in `instrumentation.ts`; use HTTP cron instead

#### B. Post-delivery journeys (`customerJourney.service.ts`)

- **Trigger:** When merged orders show `delivered` status during sync
- **Storage:** `customerJourneys`, `customerJourneyLogs`
- **Send:** AiSensy campaigns Day 0–5 (`aisensy.ts` + env campaign names)
- **Schedule:** `GET /api/cron/customer-journey` (supports `?force=true`)

**UI:**

| Route | Purpose |
|-------|---------|
| `/whatsapp/journeys` | Journey list & management |
| `/whatsapp/templates` | Message template CRUD |
| `/whatsapp/logs` | Send history |
| `/whatsapp/analytics` | Delivery stats |
| `/crm/customer-journeys` | CRM-style journey analytics |

**Why:** Automated customer onboarding and retention via WhatsApp after purchase/delivery.

---

### 8.8 Shiprocket (`/shiprocket/create-order`)

**What:** Create ad-hoc Shiprocket shipments from the CRM.

**How:** `src/services/shiprocketClient.ts` — auth token cache, create order, labels, manifests, invoices.

**APIs:** `/api/shiprocket/create-order`, `label`, `manifest`, `invoice`

**When:** Manual shipment creation by ops.

**Why:** Backup/alternate fulfillment channel alongside Air Express.

---

### 8.9 Air Express / Aaysh (`/air-express/*`)

**What:** Full logistics module for Aaysh Express partner — orders, shipments, AWB assignment, pickups, tracking, bulk import, documents (labels, manifests, invoices).

**How:** `src/services/aayshExpressClient.ts` proxies to Aaysh API; `lib/airExpressApi.ts` for client calls.

| Page | Purpose |
|------|---------|
| `/air-express/orders` | List & manage orders |
| `/air-express/create-order` | Single order creation |
| `/air-express/bulk-import` | CSV bulk upload |
| `/air-express/shipments` | Shipment management |
| `/air-express/couriers` | Courier assignment |
| `/air-express/pickups` | Pickup scheduling |
| `/air-express/tracking` | AWB / order tracking |
| `/air-express/documents` | Labels, manifests, invoices |

**When:** Primary logistics workflow for Fiberise fulfillment.

**Why:** Dedicated courier integration with richer ops tooling than generic Shiprocket UI.

---

### 8.10 Push Notifications / Advertisements (`/notifications`)

**What:** Broadcast FCM push notifications to all registered app users.

**How:** `notificationService.ts` → Firebase Cloud Messaging; tokens from Firestore `users` or legacy MongoDB.

**APIs:** `/api/send`, `/api/send-all`, `/api/broadcast-personalized`, `/api/register-token`

**When:** Marketing campaigns, feature announcements.

**Why:** Direct reach to mobile app users (complements WhatsApp).

---

### 8.11 Personalized Notifications

**What:** Targeted pushes based on user health data (steps, meals, metrics).

**How:** `personalizedNotificationService.ts` reads user subcollections and `metrics/daily`.

**API:** `/api/broadcast-personalized`

**When:** Engagement campaigns tied to app usage patterns.

---

### 8.12 Reports (`/reports`)

**What:** Downloadable **shipment PDF reports** for a date range.

**How:** `src/reports/service.ts` syncs orders, aggregates stats; `pdf-generator.ts` + Puppeteer render charts.

**API:** `GET /api/reports/shipment/download?startDate=&endDate=`

**When:** Weekly/monthly ops reviews.

---

### 8.13 Audit Logs (`/audit-logs`) — Admin only

**What:** Searchable log of user actions (login, order changes, WhatsApp sends, etc.).

**How:** `auditLogService.ts` writes to `audit_logs` with IP, user-agent parsing, before/after diffs.

**API:** `GET /api/audit-logs`

**When:** Security review, compliance, debugging user issues.

---

### 8.14 Support Tickets (`/tickets`)

**What:** Internal support ticket system.

**APIs:** `/api/support/tickets`, `/api/support/tickets/[id]/comments`

**When:** Escalations from care team or ops.

---

### 8.15 Meta Analytics (`/meta-analytics`)

**What:** Placeholder UI for future Meta ads integration.

**Status:** "Coming soon" — no backend yet.

---

### 8.16 User detail (`/user/[id]`)

**What:** Individual app user profile — health metrics, steps charts, daily health view.

**How:** Dashboard components + Firestore user subcollections.

---

### 8.17 Get Token (`/get-token`)

**What:** Dev/ops utility to register or inspect FCM tokens.

---

## 9. Background jobs & cron

| Job | Route / trigger | Frequency | What it does |
|-----|-----------------|-----------|--------------|
| Care tasks | `GET /api/cron/care-tasks` | External cron (recommended) | Generate tasks, sync calls, mark overdue |
| Customer journey | `GET /api/cron/customer-journey` | External cron | Send pending WhatsApp journey messages |
| Journey scheduler | `instrumentation.ts` → `initScheduler()` | Hourly (`0 * * * *`) | **Disabled** — use HTTP cron instead |
| WhatsApp scheduler | `POST /api/whatsapp/scheduler` | Manual / cron | Process pending journey messages (alternate entry) |

### Why HTTP cron instead of in-process?

Next.js serverless deployments restart frequently; in-process `node-cron` is unreliable. **Call cron routes from Vercel Cron, GitHub Actions, or a external scheduler** with a shared secret if you add one.

`instrumentation.ts` currently logs that the journey scheduler is disabled.

---

## 10. External integrations

| Service | Used for | Client / service file |
|---------|----------|----------------------|
| **Shopify Admin API** | Orders, webhooks, analytics | Inline in API routes, `reports/service.ts` |
| **Shiprocket API** | Tracking, labels, alternate fulfillment | `shiprocketClient.ts` |
| **Aaysh Express** | Primary logistics | `aayshExpressClient.ts` |
| **AiSensy** | WhatsApp template campaigns | `aisensy.ts`, `whatsapp.service.ts` |
| **Salestrail** | Call logs, recordings, integrations | `customerService.ts` |
| **Firebase** | Firestore, FCM, client auth | `firebase.config.ts`, `firebase.js` |
| **Mapbox** | Reverse geocoding, user map | `lib/geocoding.ts`, `UserMap` |
| **Brevo SMTP** | Email | `emailService.ts` |
| **MongoDB** | Legacy FCM tokens | `tokenService.ts` (optional) |

---

## 11. API surface

74 route handlers under `app/api/`. Grouped by domain:

### Auth
`login`, `logout`, `refresh`, `register`, `me`

### Orders & Shopify
`shopify/orders`, `shopify/orders/[id]`, `zone-analytics`, `pincode-analytics`, `gender-analytics`

### Shiprocket
`create-order`, `label`, `manifest`, `invoice`, `debug/shiprocket-order`

### Air Express
`air-express/orders/*`, `shipments/*`, `couriers/*`, `pickups/*`, `track/*`, `documents/*`

### Care & customer service
`care-tasks/*`, `customer-service/*`

### WhatsApp & CRM
`whatsapp/*`, `crm/customer-journeys/*`

### Notifications
`send`, `send-all`, `broadcast-personalized`, `register-token`

### Reports & audit
`reports/shipment/download`, `audit-logs`

### Support
`support/tickets/*`

### System
`health`, `order-status/track`, `webhooks/shopify/order-created`, `cron/*`

**Public (no JWT):** auth login/refresh/logout, webhooks, cron routes.

**Care-executive mobile app:** [CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md) (role-gated login + care panel APIs)

**Full CRM mobile-oriented reference:** [MOBILE_API.md](./MOBILE_API.md)

---

## 12. Request lifecycle

### Protected API request

```
1. Client: apiFetch('/api/care-tasks', { headers: Bearer ... })
2. middleware.ts: jwtVerify(access token) → 401 if invalid
3. route.ts: requireAuth() / requireRole() from guards.ts
4. service layer: business logic, Firestore I/O
5. optional: auditLogService.logAction()
6. JSON response
```

### Protected page request

```
1. middleware.ts: passes through (no cookie auth)
2. AuthProvider bootstrap: refresh token if needed → GET /api/auth/me
3. If unauthenticated → redirect /login
4. If care_executive on wrong path → redirect /customer-service/care-tasks
5. Page renders with Sidebar (menu filtered by role)
```

---

## 13. Running locally

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in Firebase, JWT, Shopify, Shiprocket, etc.

# Development server (webpack mode)
npm run dev

# Production build
npm run build
npm start
```

Open `http://localhost:3000` → redirects to login if not authenticated.

### Lint

```bash
npm run lint
```

### Cron in development

Manually hit cron endpoints:

```bash
curl http://localhost:3000/api/cron/care-tasks
curl http://localhost:3000/api/cron/customer-journey
```

---

## 14. Design decisions (why)

| Decision | Rationale |
|----------|-----------|
| **Firestore as primary DB** | Real-time mobile user data already lives there; server Admin SDK for secure writes |
| **JWT in localStorage, not cookies** | Supports web dashboard + mobile apps with same API; no CSRF cookie complexity |
| **Merged order cache** | Shopify is source of truth for order data; Shiprocket adds shipment status — merge once, use everywhere |
| **Disk + memory cache** | Fast UI after deploy/HMR; `.orders-cache.json` avoids empty state on cold start |
| **Separate journey systems** | `journeys` (order-created webhook) vs `customerJourneys` (post-delivery) evolved for different triggers |
| **Care tasks by phone match** | Salestrail and Shopify don't share IDs — normalized phone is the join key |
| **Role-restricted care executives** | Mobile-first workforce only needs task queue, not full CRM |
| **HTTP cron over node-cron** | Serverless-friendly; survives deploys and scale-to-zero |
| **IST date handling** | Indian ops team; `orderTimeline.ts` parses Shiprocket DD-MM-YYYY correctly |
| **Test order exclusion** | `test_orders` collection prevents live WhatsApp to simulated data |

---

## Quick reference: "When does X happen?"

| Event | When |
|-------|------|
| User logs in | Manual — `/login` |
| Shopify order → WhatsApp Day 0 | Immediately on webhook |
| Post-delivery journey starts | On order sync when status = delivered |
| Journey Day 1–5 messages | Cron `/api/cron/customer-journey` |
| Care tasks created | Cron `/api/cron/care-tasks` or manual generate |
| Calls linked to tasks | Each care-tasks cron run |
| Orders cache refresh | Every 5 min, manual refresh, or cron sync |
| Audit log written | On authenticated sensitive actions |
| Push broadcast | Manual from `/notifications` |
| Shipment PDF report | Manual from `/reports` |

---

*Last updated: August 2026. For API request/response schemas, see [MOBILE_API.md](./MOBILE_API.md) and [CARE_EXECUTIVE_MOBILE_API.md](./CARE_EXECUTIVE_MOBILE_API.md).*
