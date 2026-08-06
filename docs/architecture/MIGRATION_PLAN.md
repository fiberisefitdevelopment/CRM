# Orders Migration Plan — Firestore as Source of Truth

**Status:** Phase 6.5 complete (all production order reads via OrderRepository). Await approval before Phase 7 cache removal.

**Goal:** Stop full Shopify + Shiprocket pulls on every dashboard refresh by storing the **existing merged order shape** in Firestore and reading from there — with minimal code change and safe rollback.

---

## Non-negotiables

- Keep current API routes (e.g. `/api/shopify/orders`).
- Keep current UI pages.
- Keep current response JSON shapes (APIs, pages, mobile clients unchanged).
- Only new abstraction: `OrderRepository`.
- One phase at a time; verify after each; wait for approval.
- Feature flags for write / read / shadow / rollback.

## Out of scope (do not add)

- Domain layer, CQRS, Factory, Dependency Injection
- Event bus, Pub/Sub, Cloud Functions, BigQuery
- Dead-letter queues, event versioning, analytics materialization
- Storing unnecessary raw partner payloads
- Continuous full Shiprocket / Air Express syncs
- Disk side-store migration (phones / notes / tags) — not required for this performance fix

---

## Current problem

```
UI / APIs
  → GET /api/shopify/orders
  → ordersCache (memory + .orders-cache.json)
  → full Shopify Admin pull + Shiprocket YTD pull every ~5 minutes
  → runtime merge into Shopify-shaped objects
```

That merge is what the UI already expects. The migration **preserves that shape** in Firestore instead of rebuilding it on every refresh.

---

## Target flow

```
1. One-time backfill → Firestore `orders`
2. Verify counts & fields
3. Shopify webhooks upsert Firestore (write flag on)
4. Incremental Shiprocket + Air Express sync (open / recent only)
5. Shadow compare Firestore vs cache
6. ORDERS_READ_FROM_FIRESTORE → OrderRepository reads Firestore
7. After several successful days → remove cache / full pull
```

```
Pages → /api/shopify/orders → OrderRepository
                              ├─ flag off → ordersCache (today)
                              └─ flag on  → Firestore
```

Commands (create shipment, label, AWB, cancel) stay on existing partner API routes. After success they may patch the Firestore order when writes are enabled — no new command layer.

---

## Feature flags

| Variable | Default | Meaning |
|----------|---------|---------|
| `ORDERS_WRITE_TO_FIRESTORE` | `false` | Webhooks and sync may write. Enable **only after backfill verification**. |
| `ORDERS_READ_FROM_FIRESTORE` | `false` | `OrderRepository` serves list/get from Firestore. |
| `ORDERS_SHADOW_COMPARE` | `false` | On read path, compare cache vs Firestore and log important-field diffs. |

Rollback for reads: set `ORDERS_READ_FROM_FIRESTORE=false`.  
Rollback for writes: set `ORDERS_WRITE_TO_FIRESTORE=false`.

---

## Source identifiers (every Firestore order)

Required metadata (in addition to the existing UI fields):

| Field | When set |
|-------|----------|
| `shopifyOrderId` | Always for Shopify-origin orders; null for SR-only custom/clone if no Shopify id |
| `shiprocketOrderId` | When matched or SR-only |
| `airExpressOrderId` | When matched / known |
| `shopifyUpdatedAt` | Last write from Shopify path |
| `shiprocketUpdatedAt` | Last write from Shiprocket sync |
| `airExpressUpdatedAt` | Last write from Air Express sync |
| `updatedAt` | Last write from any source |

Do **not** store full raw Shopify / Shiprocket / Air Express payloads.

---

## Logistics sync rules

**Do not** continuously full-sync Shiprocket or Air Express.

Only synchronize orders that are (or were recently):

- Pending
- Confirmed
- Shipped
- In Transit
- Out For Delivery
- Recently Delivered

Prefer incremental sync (cursor / “updated since” / short recent window). Reuse existing match keys (`channel_order_id` ↔ Shopify `name` / id) from the current merge logic — extract helpers if needed; do not invent a new model.

---

## Shadow verification (before read cutover)

With `ORDERS_SHADOW_COMPARE=true` (and reads still from cache):

1. Load the same order set from Firestore and from cache.
2. Compare important fields (at least): `id`, `name`, `financial_status`, `payment_method`, `fulfillment_status`, shipment status / AWB, `total_price`, customer phone/name, source ids.
3. Log mismatches; fix sync/backfill gaps.
4. Enable `ORDERS_READ_FROM_FIRESTORE` only when comparisons are consistently clean.

Keep cache as fallback until then.

---

## Cache removal

Only after:

- Firestore reads have been live successfully for **several days**, and
- Shadow / spot verification still passes

Then gate off full pull on page load, keep a light reconcile cron, and finally remove `ordersCache` / `.orders-cache.json` usage.

Do **not** delete the cache code in the same phase as first enabling reads.

---

## Phases

### Phase 0 — Documentation (done)

| Item | Detail |
|------|--------|
| Objective | Record the approved simplified plan |
| Files | `docs/architecture/MIGRATION_PLAN.md`, `docs/architecture/FIRESTORE_SCHEMA.md` |
| Production code | **None** |
| Success | Docs match approved requirements |

### Phase 1 — OrderRepository facade (done)

| Item | Detail |
|------|--------|
| Objective | Add `src/repositories/orderRepository.ts` that delegates to `ordersCache`. Point `/api/shopify/orders` at it. Behavior identical. |
| Files | `src/repositories/orderRepository.ts`; `app/api/shopify/orders/route.ts`; `app/api/shopify/orders/[id]/route.ts`; this plan note |
| Effort | Small |
| Testing | `npm run build`, `npm run lint`; same cache-backed responses |
| Rollback | Revert those files |
| Risk | Low |
| Success | Same responses; no Firestore |
| Remaining direct `ordersCache` usages | See “Phase 1 leftovers” below |

#### Phase 1 leftovers (route later if straightforward)

Still import `ordersCache` directly (unchanged on purpose):

- `app/api/shopify/orders/route.ts` — two `require(...).cachedOrders` reads inside merge (left untouched to avoid changing merge logic)
- `app/api/care-tasks/order-context/route.ts`
- `app/api/care-tasks/generate/route.ts`
- `src/services/careTasks/scheduler.ts`
- `src/services/careTasks/queries.ts`
- `src/services/customerService/enrichCallsWithOrders.ts`
- `src/reports/service.ts`
- `app/api/shiprocket/create-order/route.ts`
- Dev scripts: `check_shiprocket.ts`, `check_shiprocket_fixed.ts`

### Phase 2 — Backfill + verification (done)

| Item | Detail |
|------|--------|
| Objective | Import **all existing merged cache orders** into Firestore unchanged |
| Script | `scripts/backfill-orders-to-firestore.ts` (`npm run backfill:orders`) |
| Source | `.orders-cache.json` (exact objects the UI/cache serve) |
| Doc id | Shopify-origin → `String(id)`; Shiprocket-only → `String(shiprocket_order_id \|\| id)` |
| Writes | Batched `set()` (idempotent); batch size 50 |
| Write flag / webhooks | **Not enabled** |
| APIs / UI / OrderRepository | **Not modified** |
| Report | [`docs/architecture/BACKFILL_REPORT_LATEST.json`](./BACKFILL_REPORT_LATEST.json) |

#### Merged order shape (identified before write)

- **Shopify-origin (~97 keys):** full Shopify Admin order JSON **plus** enrichment already present in cache: `source`, `payment_method`, `shiprocket_order_id`, `shiprocket_meta`, `fulfillments` (SR-enriched), `is_test_order`.
- **Shiprocket-only (~17 keys):** formatted custom/clone object from the existing merge (`source: 'shiprocket'`, customer, shipping_address, line_items, fulfillments, shiprocket_meta, …).
- Backfill stores that object **verbatim**, then adds metadata: `shopifyOrderId`, `shiprocketOrderId`, `airExpressOrderId`, `shopifyUpdatedAt`, `shiprocketUpdatedAt`, `airExpressUpdatedAt`, `updatedAt`, `nameLower`.

#### Verification result (2026-08-06)

| Metric | Value |
|--------|-------|
| total cache orders | 2126 |
| total Firestore orders | 2126 |
| Shopify orders | 1966 |
| Shiprocket-only orders | 160 |
| duplicate doc ids | 0 |
| failed writes | 0 |
| missing required fields | all 0 |

**Webhooks must not write to Firestore until Phase 3 is explicitly approved.**

### Phase 3 — Shopify webhook writes (done)

| Item | Detail |
|------|--------|
| Objective | Merge-upsert Shopify order create/update/cancel into Firestore without clobbering logistics |
| Helper | `src/services/orders/shopifyFirestoreUpsert.ts` (`set(..., { merge: true })`) |
| Routes | Existing `order-created` extended; added `order-updated`, `order-cancelled` |
| Flag | `ORDERS_WRITE_TO_FIRESTORE` (default false). Reads stay off (`ORDERS_READ_FROM_FIRESTORE=false`) |
| Journey | WhatsApp journey on create unchanged |
| Untouched | OrderRepository, ordersCache, UI, API response shapes, reports, care tasks |
| Ops | Register Shopify webhooks for `orders/updated` and `orders/cancelled` to the new URLs; set env flag `true` in the deploy env when ready |

**Logistics preserved:** merge payload omits `shiprocket_meta`, `shiprocket_order_id`, `shiprocketOrderId`, `airExpressOrderId`, `shiprocketUpdatedAt`, `airExpressUpdatedAt`, `fulfillments`.

### Phase 4 — Incremental logistics sync (done)

| Item | Detail |
|------|--------|
| Objective | Patch Firestore logistics from Shiprocket + Air Express without full history pulls |
| Shared helpers | `src/services/orders/shiprocketMergeHelpers.ts` (extracted from live merge) |
| Sync service | `src/services/orders/logisticsFirestoreSync.ts` |
| Cron | `GET/POST /api/cron/orders-logistics-sync?lookbackDays=14` |
| Shiprocket | Incremental date-window fetch (`getRecentShiprocketOrders`) + status scope filter |
| Air Express | **No webhooks in this CRM** — polling via `listAayshOrders` / `listAayshShipments` |
| Writes | `set(..., { merge: true })` logistics-only; gated by `ORDERS_WRITE_TO_FIRESTORE` |
| Reads | Still cache (`ORDERS_READ_FROM_FIRESTORE=false`) |
| Matching | Same `channel_order_id` ↔ cleaned Shopify `name` / id map as cache merge |

#### Fulfillments (future recommendation — not implemented)

Phase 3 omits Shopify `fulfillments` on write so SR/AE logistics are not wiped. Phase 4 treats **logistics-enriched `fulfillments`** as authoritative for AWB/tracking/`shipment_status`. A later redesign could deep-merge Shopify fulfillment ids with logistics tracking, but that is out of scope here — keep logistics as SoT for shipment tracking fields.

### Phase 5 — Shadow compare (done)

| Item | Detail |
|------|--------|
| Objective | Compare cache vs Firestore without serving Firestore to clients |
| Module | `src/services/orders/shadowCompare.ts` |
| Repository | `OrderRepository.getCachedOrders` / `getCachedOrderById` schedule compare only when `ORDERS_SHADOW_COMPARE=true`; always return cache |
| Full report | `npm run shadow:compare` → `docs/architecture/SHADOW_COMPARE_REPORT_LATEST.json` |
| Reads for app | Still cache (`ORDERS_READ_FROM_FIRESTORE=false`) |
| Perf | Flag off → zero Firestore reads; flag on → throttled background full compare (5 min) + optional single-doc async compare |

#### Latest full-dataset result

| Metric | Value |
|--------|------:|
| total compared | 2126 |
| matches | 2126 |
| mismatches | 0 |
| missing in Firestore | 0 |
| missing in cache | 0 |
| duplicate IDs | 0 |
| ready for Phase 6 | **yes** (after resolving 1 test-pollution mismatch from Phase 4 verify) |

### Phase 6 — Read cutover (done)

| Item | Detail |
|------|--------|
| Objective | `ORDERS_READ_FROM_FIRESTORE=true` serves orders from Firestore via OrderRepository; cache remains rollback |
| Repository | Async reads; filter/paginate/tab/order-status reuse ordersCache helpers with optional source list |
| Cache | Still updated by background Shopify+SR merge; never deleted |
| Shadow | Still available when `ORDERS_SHADOW_COMPARE=true` |
| Verify | `npm run verify:read-cutover` → `PHASE6_READ_CUTOVER_REPORT.json` |

### Phase 6.5 — Production OrderRepository cutover (done)

| Item | Detail |
|------|--------|
| Objective | Every production module that reads orders goes through `OrderRepository` only |
| Migrated | Care Tasks (queries, scheduler, generate, order-context), Customer Service enrich, Reports, Shiprocket create-order, Shopify orders merge helpers |
| Untouched | `ordersCache` itself, merge logic, webhooks, logistics Firestore sync, scripts/tests |
| Next | Phase 7 cache removal — **only after explicit approval** |

#### Verification (both modes)

| Check | Result |
|-------|--------|
| Counts 2126 vs 2126 | equal |
| First page | equal |
| Filter delivered | equal (1182) |
| Search `3003` | equal (9) |
| Order status page totals | equal (2046) |
| Tab counts | equal |
| Random sample | 0 diffs |
| Rollback to cache | OK |

**Default remains `ORDERS_READ_FROM_FIRESTORE=false` until ops enable it in env.**

### Phase 7 — Cache removal (delayed)

| Item | Detail |
|------|--------|
| Objective | After **several days** of successful Firestore reads + verification: stop page-load full sync; then remove cache |
| Testing | Reconcile cron only; spot-check vs Shopify |
| Rollback | Re-enable cache path if still present; otherwise redeploy prior revision |
| Risk | Higher — only after soak |
| Success | No `.orders-cache.json`; no full YTD pull on dashboard load |

---

## High-risk files (change carefully)

- `app/api/shopify/orders/route.ts`
- `src/services/ordersCache.ts`
- `src/utils/orderTimeline.ts`
- `src/services/shiprocketClient.ts`
- `app/api/webhooks/shopify/order-created/route.ts`
- Care-task / reports consumers of the cache

## Do not casually modify

- `middleware.ts`, JWT auth, mobile API contracts (`docs/MOBILE_API.md`), care-executive access rules, mobile `users/*` subcollections

---

## Verification checklist (backfill / shadow)

- [ ] Firestore order count ≈ cache / Shopify (explain any SR-only extras)
- [ ] `shopifyOrderId` present on Shopify-origin docs
- [ ] `shiprocketOrderId` present when cache had Shiprocket match
- [ ] Statuses: `financial_status`, fulfillment / shipment status align
- [ ] Customer name / phone / email spot-check
- [ ] `total_price`, `payment_method` spot-check
- [ ] AWB / tracking present when cache had them
- [ ] No raw partner payload blobs stored

---

## Implementation rules

1. One phase per approval cycle.
2. After each code phase: `npm run build`, `npm run lint`, smoke orders UI.
3. Prefer extracting existing merge helpers over new frameworks.
4. If a new abstraction beyond `OrderRepository` seems necessary, stop and ask.

---

## Next step

**Phase 6.5 is complete.** Production order reads go through `OrderRepository` only.

Recommended production flags:

```bash
ORDERS_WRITE_TO_FIRESTORE=true
ORDERS_READ_FROM_FIRESTORE=true
ORDERS_SHADOW_COMPARE=false
```

Rollback reads instantly:

```bash
ORDERS_READ_FROM_FIRESTORE=false
```

Do **not** remove `ordersCache` / full sync until you explicitly approve Phase 7.
