/**
 * OrderRepository — single read entry point for orders.
 *
 * ORDERS_READ_FROM_FIRESTORE=false → ordersCache (default / rollback)
 * ORDERS_READ_FROM_FIRESTORE=true  → Firestore-backed snapshot
 *
 * Performance:
 * - Instant hydrate from disk snapshot (like ordersCache)
 * - Serve memory/disk immediately; refresh Firestore in background
 * - Parallel Firestore page fetches
 */

import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import {
  CACHE_TTL_MS,
  DISK_CACHE_MAX_AGE_MS,
  addOrderToCache as cacheAddOrderToCache,
  cancelOrderInCache,
  computeTabCounts as cacheComputeTabCounts,
  expireOrdersCache,
  getActiveFetchPromise,
  getCacheExpiresAt as cacheGetExpiresAt,
  getCachedOrderById as cacheGetById,
  getCachedOrders as cacheGetAll,
  getCachedOrdersCount as cacheGetCount,
  getCachedOrdersFiltered as cacheGetFiltered,
  getCachedOrdersPaginated as cacheGetPaginated,
  getCachedOrdersPage as cacheGetPage,
  patchOrderInCache as cachePatchOrderInCache,
  getOrderStatusPaginated as cacheGetOrderStatusPaginated,
  removeOrderFromCache,
  setActiveFetchPromise,
  setCachedOrders as cacheSetCachedOrders,
  toggleTestOrderInCache,
  updateOrderNoteInCache,
  type OrderFilters,
  type OrderStatusDeliveryFilter,
  type OrderStatusListFilters,
  type TabCounts,
} from '@/src/services/ordersCache'
import {
  isOrdersShadowCompareEnabled,
  scheduleShadowCompareOne,
  scheduleThrottledFullShadowCompare,
} from '@/src/services/orders/shadowCompare'
import { mergeOrderLists, mergeShopifyOrderIntoExisting } from '@/src/services/orders/mergeOrders'

export type {
  OrderFilters,
  OrderStatusDeliveryFilter,
  OrderStatusListFilters,
  TabCounts,
}

const COLLECTION = 'orders'
const FIRESTORE_READ_TTL_MS = CACHE_TTL_MS
const PAGE_SIZE = 300
const DISK_PATH = path.join(process.cwd(), '.firestore-orders-cache.json')

/** Metadata added during migration — strip when serving so clients see cache-shaped orders. */
const SERVE_STRIP_KEYS = new Set([
  'shopifyOrderId',
  'shopifyUpdatedAt',
  'shiprocketUpdatedAt',
  'airExpressUpdatedAt',
  'updatedAt',
  'nameLower',
  // Top-level mirrors that duplicate fulfillments[0] — keep nested fulfillments for tabs.
  'awb',
  'tracking_number',
  'tracking_url',
  'shipment_status',
])

export function isOrdersReadFromFirestoreEnabled(): boolean {
  return String(process.env.ORDERS_READ_FROM_FIRESTORE || '').toLowerCase() === 'true'
}

let firestoreOrders: any[] | null = null
let firestoreExpiresAt = 0
let firestoreLoadPromise: Promise<any[]> | null = null
let firestoreHydratedFromDisk = false

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function stripForClient(order: Record<string, any>): any {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(order)) {
    if (SERVE_STRIP_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

function sortNewestFirst(orders: any[]) {
  return [...orders].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA
  })
}

function persistFirestoreDisk(orders: any[]) {
  // Defer disk write so API responses aren't blocked by ~2k-order JSON stringify
  setImmediate(() => {
    try {
      fs.writeFileSync(
        DISK_PATH,
        JSON.stringify({ savedAt: Date.now(), orders }),
        'utf-8',
      )
    } catch (e) {
      console.warn('⚠️ Failed to persist Firestore orders disk cache:', (e as Error)?.message || e)
    }
  })
}

function hydrateFirestoreFromDisk() {
  if (firestoreOrders && firestoreOrders.length > 0) return
  if (firestoreHydratedFromDisk) return
  firestoreHydratedFromDisk = true
  try {
    // Prefer dedicated FS snapshot; fall back to merge cache for instant cold start
    const candidates = [DISK_PATH, path.join(process.cwd(), '.orders-cache.json')]
    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const orders = Array.isArray(raw?.orders) ? raw.orders : null
      const savedAt = typeof raw?.savedAt === 'number' ? raw.savedAt : 0
      if (!orders?.length) continue
      if (savedAt && Date.now() - savedAt > DISK_CACHE_MAX_AGE_MS) continue
      firestoreOrders = orders.map((o: any) => stripForClient({ ...o }))
      // Stale TTL so a background refresh still runs
      firestoreExpiresAt = 0
      const label = filePath.endsWith('.firestore-orders-cache.json')
        ? 'Firestore disk snapshot'
        : 'orders cache (bootstrap)'
      console.log(`⚡ Hydrated ${orders.length} orders from ${label}`)
      return
    }
  } catch (e) {
    console.warn('⚠️ Failed to hydrate Firestore disk cache:', (e as Error)?.message || e)
  }
}

async function fetchAllFirestoreOrdersRaw(): Promise<any[]> {
  const db = getDb()
  const all: any[] = []
  let last: admin.firestore.QueryDocumentSnapshot | undefined

  // First page
  let q: admin.firestore.Query = db
    .collection(COLLECTION)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(PAGE_SIZE)
  let snap = await q.get()
  if (snap.empty) return []

  for (const doc of snap.docs) {
    all.push(stripForClient({ id: doc.data()?.id ?? doc.id, ...doc.data() }))
  }
  last = snap.docs[snap.docs.length - 1]

  // Subsequent pages in parallel batches of 4 cursors chained sequentially by batch
  // (each batch needs the previous last doc). Within a batch we can't easily parallel
  // without knowing cursors — keep sequential but larger page size for fewer RTTs.
  while (snap.size === PAGE_SIZE) {
    q = db
      .collection(COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(last)
      .limit(PAGE_SIZE)
    snap = await q.get()
    if (snap.empty) break
    for (const doc of snap.docs) {
      all.push(stripForClient({ id: doc.data()?.id ?? doc.id, ...doc.data() }))
    }
    last = snap.docs[snap.docs.length - 1]
  }

  return sortNewestFirst(all)
}

function newestCreatedAtMs(orders: any[] | null | undefined): number {
  if (!orders?.length) return 0
  // Lists are newest-first; scan a small head in case of ties/clones
  let max = 0
  for (const o of orders.slice(0, 80)) {
    const t = new Date(o?.created_at || 0).getTime()
    if (Number.isFinite(t) && t > max) max = t
  }
  return max
}

/**
 * True when the in-memory/disk snapshot already has newer orders than a
 * Firestore dump (e.g. after Shopify+SR merge, before webhooks catch up).
 */
function localSnapshotIsFresherThan(remote: any[]): boolean {
  if (!firestoreOrders?.length) return false
  const localMax = newestCreatedAtMs(firestoreOrders)
  const remoteMax = newestCreatedAtMs(remote)
  if (localMax > remoteMax) return true
  if (localMax === remoteMax && firestoreOrders.length > remote.length) return true
  return false
}

function adoptFirestoreOrders(orders: any[], ttlMs = FIRESTORE_READ_TTL_MS) {
  firestoreOrders = sortNewestFirst(orders)
  firestoreExpiresAt = Date.now() + ttlMs
  persistFirestoreDisk(firestoreOrders)
}

function refreshFirestoreInBackground() {
  if (firestoreLoadPromise) return
  firestoreLoadPromise = fetchAllFirestoreOrdersRaw()
    .then((orders) => {
      hydrateFirestoreFromDisk()
      const local = firestoreOrders || []
      // Union remote + local so webhook/live Shopify orders never disappear
      // and a slower dump never rolls back newer local rows.
      const merged = mergeOrderLists(orders, local)
      if (localSnapshotIsFresherThan(orders) && merged.length === local.length) {
        firestoreExpiresAt = Date.now() + FIRESTORE_READ_TTL_MS
        console.log(
          `⚡ Firestore dump merged (kept local-fresh snapshot: ${merged.length} orders)`,
        )
        adoptFirestoreOrders(merged)
        return merged
      }
      adoptFirestoreOrders(merged)
      console.log(`⚡ Firestore orders snapshot refreshed: ${merged.length}`)
      return merged
    })
    .catch((err) => {
      console.warn('⚠️ Firestore orders refresh failed:', err?.message || err)
      // Keep serving existing snapshot
      if (firestoreOrders?.length) {
        firestoreExpiresAt = Date.now() + 30_000
      }
      throw err
    })
    .finally(() => {
      firestoreLoadPromise = null
    })
}

/**
 * Fast path: return memory/disk immediately.
 * Only block on network if we have no local data at all.
 */
async function ensureFirestoreOrders(): Promise<any[]> {
  hydrateFirestoreFromDisk()

  const now = Date.now()
  const hasLocal = !!(firestoreOrders && firestoreOrders.length > 0)
  const isFresh = hasLocal && now < firestoreExpiresAt

  if (isFresh) return firestoreOrders!

  // Stale or empty: kick background refresh
  refreshFirestoreInBackground()

  if (hasLocal) {
    // Serve stale instantly — do not wait for network
    return firestoreOrders!
  }

  // Cold start with no disk: must wait once
  return firestoreLoadPromise!
}

/** Force next Firestore read to reload (tests / after writes). */
export function expireFirestoreOrdersSnapshot() {
  firestoreExpiresAt = 0
}

/**
 * When the Shopify+SR merge finishes, also update the Firestore *read* snapshot
 * so the UI sees new orders without waiting for a full Firestore re-download.
 * (DB writes still go through webhooks / logistics sync when WRITE flag is on.)
 */
function setCachedOrders(orders: any[], expiresAt: number) {
  cacheSetCachedOrders(orders, expiresAt)
  if (isOrdersReadFromFirestoreEnabled() && Array.isArray(orders) && orders.length > 0) {
    adoptFirestoreOrders(
      orders.map((o) => stripForClient({ ...o })),
      FIRESTORE_READ_TTL_MS,
    )
    // Keep Firestore DB from falling behind when webhooks don't reach this process
    // (common on localhost). Newest Shopify-origin orders only — merge:true, logistics-safe.
    void pushRecentShopifyOrdersToFirestore(orders).catch((err) => {
      console.warn('⚠️ Recent Shopify→Firestore catch-up failed:', err?.message || err)
    })
  }
}

/** Upsert the newest N Shopify orders into Firestore (idempotent, feature-flagged). */
async function pushRecentShopifyOrdersToFirestore(orders: any[], limit = 40) {
  const { upsertShopifyOrderToFirestore, isOrdersWriteToFirestoreEnabled } = await import(
    '@/src/services/orders/shopifyFirestoreUpsert'
  )
  if (!isOrdersWriteToFirestoreEnabled()) return

  const recent = sortNewestFirst(orders)
    .filter((o) => o && o.id && (o.source === 'shopify' || !o.source || o.source === undefined))
    // Prefer true Shopify ids (numeric / long); skip obvious SR-only customs without shopify shape
    .filter((o) => o.line_items || o.checkout_id || o.admin_graphql_api_id || o.order_number != null)
    .slice(0, limit)

  let written = 0
  for (const order of recent) {
    try {
      const res = await upsertShopifyOrderToFirestore(order)
      if (!res.skipped) written += 1
    } catch {
      // continue remaining
    }
  }
  if (written > 0) {
    console.log(`✅ Caught up ${written} recent Shopify orders into Firestore`)
  }
}

/** Instant local apply after Shopify webhook / Admin upsert (cache + FS read snapshot). */
function applyShopifyOrderToLocalSnapshot(shopifyOrder: Record<string, any>) {
  if (!shopifyOrder?.id) return
  const incoming = stripForClient({ ...shopifyOrder })
  const existing =
    cacheGetById(incoming.id) ||
    firestoreOrders?.find((o) => String(o.id) === String(incoming.id)) ||
    null
  const order = mergeShopifyOrderIntoExisting(existing, incoming)
  cacheAddOrderToCache(order)
  mirrorOrderIntoFirestoreSnapshot(order)
}

/** Merge a batch of orders (live Shopify pull) into both snapshots without a full replace. */
function mergeOrdersIntoSnapshot(incoming: any[]) {
  if (!Array.isArray(incoming) || incoming.length === 0) return
  const cleaned = incoming.map((o) => stripForClient({ ...o }))

  const cacheAll = cacheGetAll() || []
  if (cacheAll.length > 0) {
    const mergedCache = mergeOrderLists(cacheAll, cleaned)
    const ttl = cacheGetExpiresAt()
    cacheSetCachedOrders(mergedCache, ttl > Date.now() ? ttl : Date.now() + CACHE_TTL_MS)
  } else {
    // Don't let a 50-order live pull become the entire cache on cold start
    for (const o of cleaned) cacheAddOrderToCache(o)
  }

  if (isOrdersReadFromFirestoreEnabled()) {
    hydrateFirestoreFromDisk()
    if (firestoreOrders && firestoreOrders.length > 0) {
      firestoreOrders = mergeOrderLists(firestoreOrders, cleaned)
      persistFirestoreDisk(firestoreOrders)
    } else {
      for (const o of cleaned) mirrorOrderIntoFirestoreSnapshot(o)
    }
  }
}

/** When reading Firestore, keep the in-memory FS snapshot aligned with a single-order write. */
function mirrorOrderIntoFirestoreSnapshot(order: any) {
  if (!isOrdersReadFromFirestoreEnabled() || !order?.id) return
  hydrateFirestoreFromDisk()
  const cleaned = stripForClient({ ...order })
  if (!firestoreOrders) {
    firestoreOrders = [cleaned]
  } else {
    const id = String(cleaned.id)
    const idx = firestoreOrders.findIndex((o) => String(o.id) === id)
    if (idx >= 0) {
      firestoreOrders[idx] = { ...firestoreOrders[idx], ...cleaned }
    } else {
      firestoreOrders = [cleaned, ...firestoreOrders]
    }
    firestoreOrders = sortNewestFirst(firestoreOrders)
  }
  persistFirestoreDisk(firestoreOrders)
}

function addOrderToCache(order: any) {
  const existing =
    cacheGetById(order?.id) ||
    firestoreOrders?.find((o) => String(o.id) === String(order?.id)) ||
    null
  const merged = mergeShopifyOrderIntoExisting(existing, order)
  cacheAddOrderToCache(merged)
  mirrorOrderIntoFirestoreSnapshot(merged)
}

function patchOrderInCache(id: string | number, patch: Record<string, unknown>) {
  // Always try the Shopify merge cache first.
  let updated = cachePatchOrderInCache(id, patch)

  // When Firestore is the read source, also patch the FS snapshot directly.
  // cachePatch can no-op if `cachedOrders` is empty/out of sync — that left shipped
  // orders stuck in the "New" tab (fulfillment_status never became fulfilled).
  if (isOrdersReadFromFirestoreEnabled()) {
    hydrateFirestoreFromDisk()
    const idStr = String(id)
    const existing =
      updated ||
      firestoreOrders?.find((o) => String(o.id) === idStr) ||
      null

    if (existing) {
      const merged = stripForClient({ ...existing, ...patch })
      if (!firestoreOrders) {
        firestoreOrders = [merged]
      } else {
        const idx = firestoreOrders.findIndex((o) => String(o.id) === idStr)
        if (idx >= 0) {
          firestoreOrders[idx] = { ...firestoreOrders[idx], ...merged }
        } else {
          firestoreOrders = [merged, ...firestoreOrders]
          firestoreOrders = sortNewestFirst(firestoreOrders)
        }
      }
      // Keep FS snapshot authoritative for a bit so a background refresh doesn't wipe the ship.
      firestoreExpiresAt = Date.now() + FIRESTORE_READ_TTL_MS
      persistFirestoreDisk(firestoreOrders)
      updated = firestoreOrders.find((o) => String(o.id) === idStr) || merged
    }
  } else if (updated) {
    mirrorOrderIntoFirestoreSnapshot(updated)
  }

  // Persist logistics onto Firestore docs so reloads keep Ready To Ship bucketing.
  if (updated) {
    void persistShipLogisticsToFirestore(id, patch, updated).catch((err) => {
      console.warn('⚠️ Ship logistics Firestore write failed:', (err as Error)?.message || err)
    })
  }

  return updated
}

async function persistShipLogisticsToFirestore(
  id: string | number,
  patch: Record<string, unknown>,
  order: any,
) {
  const { isOrdersWriteToFirestoreEnabled } = await import(
    '@/src/services/orders/shopifyFirestoreUpsert'
  )
  if (!isOrdersWriteToFirestoreEnabled()) return

  const nowIso = new Date().toISOString()
  const payload: Record<string, unknown> = {
    fulfillment_status: patch.fulfillment_status ?? order.fulfillment_status ?? null,
    fulfillments: patch.fulfillments ?? order.fulfillments ?? [],
    updatedAt: nowIso,
  }
  if (patch.shiprocket_order_id != null || patch.shiprocketOrderId != null) {
    payload.shiprocket_order_id = patch.shiprocket_order_id ?? patch.shiprocketOrderId
    payload.shiprocketOrderId = patch.shiprocketOrderId ?? patch.shiprocket_order_id
    payload.shiprocketUpdatedAt = nowIso
  }
  if (patch.shiprocket_meta != null) payload.shiprocket_meta = patch.shiprocket_meta
  if (patch.airExpressOrderId != null) {
    payload.airExpressOrderId = patch.airExpressOrderId
    payload.airExpressUpdatedAt = nowIso
  }
  if (patch.logistics != null) payload.logistics = patch.logistics

  const f0 = (payload.fulfillments as any[])?.[0]
  if (f0) {
    payload.shipment_status = f0.shipment_status || null
    payload.tracking_number = f0.tracking_number || null
    payload.tracking_url = f0.tracking_url || null
    payload.awb = f0.tracking_number || null
  }

  await getDb()
    .collection(COLLECTION)
    .doc(String(id))
    .set(payload, { merge: true })
}

function getCacheExpiresAt() {
  if (isOrdersReadFromFirestoreEnabled()) return firestoreExpiresAt
  return cacheGetExpiresAt()
}

async function resolveSourceOrders(): Promise<any[] | null> {
  if (!isOrdersReadFromFirestoreEnabled()) {
    return cacheGetAll()
  }
  return ensureFirestoreOrders()
}

async function getCachedOrders(): Promise<any[] | null> {
  const orders = await resolveSourceOrders()
  if (isOrdersShadowCompareEnabled() && orders?.length) {
    const cacheOrders = cacheGetAll() || []
    if (cacheOrders.length) scheduleThrottledFullShadowCompare(cacheOrders)
  }
  return orders
}

async function getCachedOrderById(id: string | number) {
  if (!isOrdersReadFromFirestoreEnabled()) {
    const order = cacheGetById(id)
    if (isOrdersShadowCompareEnabled() && order) scheduleShadowCompareOne(order)
    return order
  }

  const orders = await ensureFirestoreOrders()
  const order = orders.find((o) => String(o.id) === String(id)) || null
  if (isOrdersShadowCompareEnabled()) {
    const cacheOrder = cacheGetById(id)
    if (cacheOrder) scheduleShadowCompareOne(cacheOrder)
  }
  return order
}

async function getCachedOrdersFiltered(filters: OrderFilters = {}, sourceOrders?: any[] | null) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheGetFiltered(filters, source)
}

async function getCachedOrdersCount(filters: OrderFilters = {}, sourceOrders?: any[] | null) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheGetCount(filters, source)
}

async function getCachedOrdersPaginated(
  page: number,
  perPage: number,
  filters: OrderFilters = {},
  sourceOrders?: any[] | null,
) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheGetPaginated(page, perPage, filters, source)
}

async function getCachedOrdersPage(
  page: number,
  perPage: number,
  filters: OrderFilters = {},
  sourceOrders?: any[] | null,
) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheGetPage(page, perPage, filters, source)
}

async function computeTabCounts(
  filters: Omit<OrderFilters, 'tab'> = {},
  sourceOrders?: any[] | null,
) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheComputeTabCounts(filters, source)
}

async function getOrderStatusPaginated(
  page: number,
  perPage: number,
  filters: OrderStatusListFilters = {},
  sourceOrders?: any[] | null,
) {
  const source = sourceOrders ?? (await resolveSourceOrders())
  return cacheGetOrderStatusPaginated(page, perPage, filters, source)
}

export const OrderRepository = {
  CACHE_TTL_MS,
  DISK_CACHE_MAX_AGE_MS,

  getCachedOrders,
  setCachedOrders,
  getCacheExpiresAt,
  expireOrdersCache,
  getCachedOrderById,
  removeOrderFromCache,
  cancelOrderInCache,
  getActiveFetchPromise,
  setActiveFetchPromise,
  getCachedOrdersCount,
  getCachedOrdersPaginated,
  getCachedOrdersPage,
  getCachedOrdersFiltered,
  getOrderStatusPaginated,
  computeTabCounts,
  addOrderToCache,
  patchOrderInCache,
  toggleTestOrderInCache,
  updateOrderNoteInCache,
  expireFirestoreOrdersSnapshot,
  applyShopifyOrderToLocalSnapshot,
  mergeOrdersIntoSnapshot,
  isOrdersReadFromFirestoreEnabled,
} as const

export default OrderRepository
