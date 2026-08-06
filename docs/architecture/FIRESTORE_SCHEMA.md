# Firestore Schema — `orders` (lean)

**Purpose:** Persist the **same merged order shape** the CRM UI and `/api/shopify/orders` already return, plus source identifiers and per-source timestamps.

**Collection:** `orders`

**Not in this migration:** timeline subcollections, `failedEvents`, `webhookEvents`, analytics docs, raw partner payload blobs, disk side-stores.

See also: [MIGRATION_PLAN.md](./MIGRATION_PLAN.md).

---

## Document identity

| Origin | Doc id |
|--------|--------|
| Shopify order | `String(shopifyOrder.id)` |
| Shiprocket-only custom/clone (no Shopify match) | Stable id already used in cache today (typically `String(shiprocketOrder.id)`) |

Always set source id fields even when they duplicate the doc id.

---

## Required source metadata

Every document must include:

```ts
{
  shopifyOrderId: string | null
  shiprocketOrderId: string | number | null
  airExpressOrderId: string | null
  shopifyUpdatedAt: string | null      // ISO
  shiprocketUpdatedAt: string | null   // ISO
  airExpressUpdatedAt: string | null   // ISO
  updatedAt: string                    // ISO — last write any source
}
```

Map existing cache fields when present:

- `shiprocket_order_id` → also store as `shiprocketOrderId`
- Shopify `id` → `shopifyOrderId`

Do **not** store full raw Shopify / Shiprocket / Air Express API responses.

---

## UI / API body (preserve existing shape)

Store the fields the dashboard already relies on after today’s merge. The list below mirrors the live merged object (Shopify base + Shiprocket enrichment + custom SR orders). Exact nested Shopify money/set fields may exist on Shopify-origin docs as they do in cache today; **do not strip fields the UI already reads**.

### Core commerce

| Field | Notes |
|-------|--------|
| `id` | Same as today (Shopify id or SR id for custom) |
| `name` | e.g. `#1234` |
| `created_at` | |
| `updated_at` | Shopify updated_at when present |
| `cancelled_at` | |
| `financial_status` | |
| `fulfillment_status` | |
| `payment_method` | `cod` / `prepaid` (from Shiprocket enrichment when available) |
| `total_price` | string |
| `currency` | |
| `email` / `contact_email` | when present |
| `source` | e.g. `shopify` / `shiprocket` |
| `is_test_order` | boolean |

### Customer & address

| Field | Notes |
|-------|--------|
| `customer` | `{ first_name, last_name, email, phone }` |
| `shipping_address` | existing address shape |
| `billing_address` | when present on Shopify orders |

### Line items

| Field | Notes |
|-------|--------|
| `line_items` | existing array (`title`, `sku`, `quantity`, `price`, …) |

### Logistics (merged)

| Field | Notes |
|-------|--------|
| `fulfillments` | including `tracking_number`, `tracking_company`, `tracking_url`, `shipment_status`, `shipment_status_reason`, dates |
| `shiprocket_meta` | **selected** operational fields already set in merge today (status, pickup, dates, delay/rto flags, activities). Prefer this curated object over dumping the full Shiprocket order. |

Air Express fields (when synced): patch the same fulfillment / tracking fields the UI already understands; set `airExpressOrderId` + `airExpressUpdatedAt`. Avoid a second competing shape unless the UI already has one.

### Search helpers (optional, small)

| Field | Notes |
|-------|--------|
| `nameLower` | `name` without `#`, lowercased — for equality search |

---

## What not to store

- Full Admin API order dumps beyond what cache already keeps for UI
- Full Shiprocket list-row JSON (use curated `shiprocket_meta` + ids)
- Full Air Express API payloads
- Duplicate blob copies “for debugging” in production docs

---

## Indexes (add when queries need them)

Start with doc-id gets and in-memory filter parity if backfill size stays small; add composite indexes only when repository queries require them:

1. `created_at` descending (list newest first)
2. `fulfillments` / shipment status — if filtered in query (may use a denormalized `shipment_status` top-level field copied from first fulfillment for indexing)
3. `nameLower` ascending (search)
4. `shiprocketOrderId` (lookup by SR id)
5. `airExpressOrderId` (lookup by AE id)

If top-level `shipment_status` is added for indexing, keep it in sync with `fulfillments[0].shipment_status` so the UI shape stays authoritative.

---

## Security

- Server Admin SDK only for CRM writes/reads (same pattern as existing services).
- Do not expose the `orders` collection to untrusted client SDK rules for public write.
- Align future security rules with existing JWT-gated API access; clients continue to call Next.js APIs, not Firestore directly for orders.

---

## Backfill verification fields

When comparing Firestore ↔ cache / Shopify, check at least:

- Document count (account for SR-only extras)
- `id` / `name`
- `shopifyOrderId`, `shiprocketOrderId`, `airExpressOrderId`
- `financial_status`, `payment_method`, `fulfillment_status`
- Shipment status / AWB
- `total_price`
- Customer name / phone
- `shopifyUpdatedAt` / `shiprocketUpdatedAt` / `airExpressUpdatedAt` / `updatedAt` populated as expected

---

## Fulfillments ownership (Phase 3 + 4)

- **Phase 3 (Shopify webhooks):** intentionally does **not** write `fulfillments` (shallow merge would replace logistics AWB/status).
- **Phase 4 (logistics sync):** writes logistics-enriched `fulfillments` + mirrors (`awb`, `tracking_number`, `shipment_status`, …).

**Recommendation for later phases:** keep logistics as the authoritative source for tracking/AWB/`shipment_status`. If Shopify native fulfillments are needed, deep-merge by fulfillment id rather than replacing the array. Do not change Phase 3 omission until that redesign exists.
