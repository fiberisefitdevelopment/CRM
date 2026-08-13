// Dedicated in-memory cache service for Shopify and Shiprocket orders
// to comply with Next.js App Router route file export limitations.
// Also persists a disk snapshot so cold starts / HMR can serve instantly.

import fs from 'fs'
import path from 'path'
import {
  buildAlerts,
  getDelayDays,
  hasRtoInitiated,
  isActiveRtoStatus,
  isCreatedInDateRange,
  isNotShippedStatus,
  hasAssignedTrackingNumber,
  isOrderDelayed,
  isReadyForPickupStatus,
  isShiprocketDeliveredStatus,
  isShiprocketInTransitStatus,
  normalizeShipmentStatus,
  paymentLabel,
  toIstDateKey,
  trailHasActiveRto,
} from '@/src/utils/orderTimeline'
import {
  cleanOrderName,
  getCloneParentBase,
  getOperationalOrder,
} from '@/src/utils/cloneOrders'
import { isCodOrder } from '@/src/utils/orderPayment'
import { hasCodConfirmation, resolveCodConfirmationKind } from '@/src/utils/careOrderTags'
import { lookupCareOrderTag } from '@/src/services/careOrderTagStore'

export let cachedOrders: any[] | null = null
export let cacheExpiresAt = 0
export const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes in-memory cache
/** How long a disk snapshot is considered usable for instant boot. */
export const DISK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DISK_CACHE_PATH = path.join(process.cwd(), '.orders-cache.json')

export let activeFetchPromise: Promise<any> | null = null

function hydrateFromDisk() {
  if (cachedOrders && cachedOrders.length > 0) return
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf-8'))
    const orders = Array.isArray(raw?.orders) ? raw.orders : null
    const savedAt = typeof raw?.savedAt === 'number' ? raw.savedAt : 0
    if (!orders?.length) return
    if (Date.now() - savedAt > DISK_CACHE_MAX_AGE_MS) return
    cachedOrders = orders
    // Stale TTL so the next request still triggers a background refresh
    cacheExpiresAt = 0
    console.log(`⚡ Hydrated ${orders.length} orders from disk cache`)
  } catch (e) {
    console.warn('⚠️ Failed to hydrate orders disk cache:', (e as Error)?.message || e)
  }
}

function persistToDisk(orders: any[]) {
  try {
    // Fire-and-forget style write; keep payload lean enough for cold starts
    fs.writeFileSync(
      DISK_CACHE_PATH,
      JSON.stringify({ savedAt: Date.now(), orders }),
      'utf-8',
    )
  } catch (e) {
    console.warn('⚠️ Failed to persist orders disk cache:', (e as Error)?.message || e)
  }
}

// Hydrate once on module load so the first API hit is instant after restart
hydrateFromDisk()

export function getCachedOrders() {
  if (!cachedOrders || cachedOrders.length === 0) hydrateFromDisk()
  return cachedOrders
}

export function setCachedOrders(orders: any[], expiresAt: number) {
  // Always store newest-first so paginated page 1 shows the most recent orders
  cachedOrders = [...orders].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA // descending
  })
  cacheExpiresAt = expiresAt
  persistToDisk(cachedOrders)
}

export function getCacheExpiresAt() {
  return cacheExpiresAt
}

/** Force the next request to treat cache as stale and re-sync. */
export function expireOrdersCache() {
  cacheExpiresAt = 0
}

export function getCachedOrderById(id: string | number) {
  return cachedOrders?.find(o => String(o.id) === String(id)) || null
}

export function removeOrderFromCache(id: string | number) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.filter(o => String(o.id) !== String(id))
  }
}

export function cancelOrderInCache(id: string | number) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.map(o => {
      if (String(o.id) === String(id)) {
        return {
          ...o,
          cancelled_at: new Date().toISOString(),
          financial_status: 'voided'
        }
      }
      return o
    })
  }
}

export function getActiveFetchPromise() {
  return activeFetchPromise
}

export function setActiveFetchPromise(p: Promise<any> | null) {
  activeFetchPromise = p
}

// ── Paginated Access ─────────────────────────────────────────────────────────

export interface OrderFilters {
  tab?: string
  search?: string
  financial?: string
  paymentType?: string
  channel?: string
  courier?: string
  pickupLocation?: string
  weightClass?: string
  rtoRisk?: string
  minPrice?: string
  maxPrice?: string
  datePreset?: string
  startDate?: string
  endDate?: string
  fulfillmentStatus?: string
  is_test_order?: boolean
  /** When true, keep test orders in results (Order Status / Shopify parity counts). */
  includeTest?: boolean
  /** Confirmed tab sub-filter: Care vs AiSensy. */
  careConfirmSource?: 'care_confirmed' | 'aisensy_confirmed' | 'all'
}

export function getCachedOrdersCount(filters: OrderFilters = {}, sourceOrders?: any[] | null): number {
  return getCachedOrdersFiltered(filters, sourceOrders).length
}

export function getCachedOrdersPaginated(
  page: number,
  perPage: number,
  filters: OrderFilters = {},
  sourceOrders?: any[] | null,
): any[] {
  const filtered = getCachedOrdersFiltered(filters, sourceOrders)
  // Newest order-created first — same as Order Status / Shiprocket list
  const sorted = [...filtered].sort((a, b) => {
    let dateStrA = a.created_at
    let dateStrB = b.created_at
    if (filters.tab === 'cancelled') {
      dateStrA = a.cancelled_at || a.created_at
      dateStrB = b.cancelled_at || b.created_at
    }
    const dateA = new Date(dateStrA || 0).getTime()
    const dateB = new Date(dateStrB || 0).getTime()
    return dateB - dateA
  })
  const start = (page - 1) * perPage
  return sorted.slice(start, start + perPage)
}

// ── Tab Count Computation ────────────────────────────────────────────────────
// Mirrors the frontend tab-bucketing logic so counts can be returned server-side

function isOrderCancelled(order: any): boolean {
  return (
    !!order.cancelled_at ||
    order.financial_status?.toLowerCase() === 'voided' ||
    order.financial_status?.toLowerCase() === 'cancelled' ||
    order.financial_status?.toLowerCase() === 'refunded' ||
    order.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

/** COD with no Care confirmed, no AiSensy confirmed tag, and no AWB assigned yet. */
function isCodNotConfirmed(order: any, live?: any): boolean {
  if (!isCodOrder(order)) return false
  const op = live || order
  if (isOrderCancelled(op)) return false
  if (hasAssignedTrackingNumber(op) || hasAssignedTrackingNumber(order)) return false
  const careTag = order.care_tag || lookupCareOrderTag(order.id, order.name)
  return !hasCodConfirmation({ ...order, care_tag: careTag })
}

/**
 * Not Shipped bucket: prepaid + not shipped, or COD confirmed via
 * Customer Care / AiSensy + not shipped. Unconfirmed COD stays in COD Not Confirmed.
 * Orders with an AWB / tracking number never belong here.
 */
function isNotShippedBucket(order: any, live?: any): boolean {
  const op = live || order
  if (isOrderCancelled(op)) return false
  if (hasAssignedTrackingNumber(op) || hasAssignedTrackingNumber(order)) return false
  if (!isNotShippedStatus(op)) return false
  if (!isCodOrder(order)) return true
  const careTag = order.care_tag || lookupCareOrderTag(order.id, order.name)
  return hasCodConfirmation({ ...order, care_tag: careTag })
}

/** Care / AiSensy confirmed and still waiting to ship. */
function isConfirmedAwaitingShipment(
  order: any,
  live?: any,
  source: 'care_confirmed' | 'aisensy_confirmed' | 'all' = 'all',
): boolean {
  const op = live || order
  if (isOrderCancelled(op) || !isNotShippedStatus(op)) return false
  const careTag = order.care_tag || lookupCareOrderTag(order.id, order.name)
  const tagged = { ...order, care_tag: careTag }
  const kind = resolveCodConfirmationKind(tagged)
  if (!kind) return false
  if (source === 'all') return true
  return kind === source
}

/** Resolve date presets / bounds to inclusive IST YYYY-MM-DD keys (Shiprocket parity). */
function resolveIstDateBounds(filters: {
  datePreset?: string
  startDate?: string
  endDate?: string
}): { start: string; end: string } {
  let start = filters.startDate || ''
  let end = filters.endDate || ''

  if (filters.datePreset && filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
    const now = new Date()
    const endKey = toIstDateKey(now.toISOString())
    if (filters.datePreset === 'today') {
      start = endKey
      end = endKey
    } else if (filters.datePreset === 'yesterday') {
      const yKey = toIstDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
      start = yKey
      end = yKey
    } else if (filters.datePreset === '7days') {
      start = toIstDateKey(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString())
      end = endKey
    } else if (filters.datePreset === '30days') {
      start = toIstDateKey(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString())
      end = endKey
    } else if (filters.datePreset === '90days') {
      start = toIstDateKey(new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString())
      end = endKey
    }
  }

  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) start = toIstDateKey(start)
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) end = toIstDateKey(end)

  return { start, end }
}

/** Ready to Ship: fulfilled + not yet in transit / OFD / delivered / RTO / failed. */
function isReadyToShipStatus(order: any): boolean {
  if (isOrderCancelled(order)) return false
  if (order?.fulfillment_status !== 'fulfilled') return false
  if (isShiprocketInTransitStatus(order)) return false
  if (isShiprocketDeliveredStatus(order)) return false
  if (isActiveRtoStatus(order)) return false
  const status = normalizeShipmentStatus(order)
  return !['out_for_delivery', 'rto_delivered', 'failed', 'failure', 'cancelled', 'delivered', 'rto'].includes(
    status,
  )
}

export interface TabCounts {
  new: number
  ready_to_ship: number
  pickups_manifests: number
  in_transit: number
  delivered: number
  rto: number
  cancelled: number
  all: number
  test_orders: number
  confirmed: number
  confirmed_care: number
  confirmed_aisensy: number
}

export function computeTabCounts(
  filters: Omit<OrderFilters, 'tab'> = {},
  sourceOrders?: any[] | null,
): TabCounts {
  const counts: TabCounts = {
    new: 0,
    ready_to_ship: 0,
    pickups_manifests: 0,
    in_transit: 0,
    delivered: 0,
    rto: 0,
    cancelled: 0,
    all: 0,
    test_orders: 0,
    confirmed: 0,
    confirmed_care: 0,
    confirmed_aisensy: 0,
  }

  const baseList = sourceOrders !== undefined ? sourceOrders : cachedOrders

  // Count test orders directly from memory cache
  if (baseList) {
    counts.test_orders = baseList.filter(o => o.is_test_order === true).length
  }

  // Get list without date filters first, then apply date filters dynamically inside the loop
  const { datePreset, startDate, endDate, ...otherFilters } = filters
  const list = getCachedOrdersFiltered({ ...otherFilters, tab: 'all' }, sourceOrders)
  if (list.length === 0) return counts

  const { start: resolvedStart, end: resolvedEnd } = resolveIstDateBounds({
    datePreset,
    startDate,
    endDate,
  })

  const isOrderDateInRange = (o: any) => isCreatedInDateRange(o, resolvedStart, resolvedEnd)

  const checkCancelDateInRange = (dateStr: string) => {
    if (!resolvedStart && !resolvedEnd) return true
    const key = toIstDateKey(dateStr)
    if (!key) return true
    if (resolvedStart && key < resolvedStart) return false
    if (resolvedEnd && key > resolvedEnd) return false
    return true
  }

  const now = Date.now()

  for (const o of list) {
    const inRange = isOrderDateInRange(o)

    if (inRange) {
      counts.all++
    }

    if (isOrderCancelled(o)) {
      const cancelDate = o.cancelled_at || o.created_at
      if (checkCancelDateInRange(cancelDate)) {
        counts.cancelled++
      }
      continue
    }

    if (inRange && isConfirmedAwaitingShipment(o)) {
      counts.confirmed++
      const careTag = o.care_tag || lookupCareOrderTag(o.id, o.name)
      const kind = resolveCodConfirmationKind({ ...o, care_tag: careTag })
      if (kind === 'care_confirmed') counts.confirmed_care++
      else if (kind === 'aisensy_confirmed') counts.confirmed_aisensy++
    }

    if (!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') {
      const ageInMs = now - new Date(o.created_at).getTime()
      const ageInDays = ageInMs / (1000 * 60 * 60 * 24)
      if (ageInDays <= 2 && inRange) {
        counts.new++
      }
      continue
    }

    // Shiprocket tab parity (same helpers as Order Status) — no raw status denylist
    if (isShiprocketInTransitStatus(o)) {
      if (inRange) counts.in_transit++
    } else if (isShiprocketDeliveredStatus(o)) {
      if (inRange) counts.delivered++
    } else if (isActiveRtoStatus(o)) {
      if (inRange) counts.rto++
    } else if (isReadyToShipStatus(o)) {
      if (inRange) counts.ready_to_ship++
    }
    // OFD / rto_delivered / failure sit outside these ops tabs (visible under All)
  }

  return counts
}

// ── Generic Filter Logic ─────────────────────────────────────────────────────

export function getCachedOrdersFiltered(
  filters: OrderFilters = {},
  sourceOrders?: any[] | null,
): any[] {
  const base = sourceOrders !== undefined ? sourceOrders : cachedOrders
  if (!base) return []

  let list = base

  // Filter test orders first
  const tab = filters.tab || 'all'
  if (tab === 'test_orders') {
    list = list.filter(o => o.is_test_order === true)
  } else if (!filters.includeTest) {
    list = list.filter(o => o.is_test_order !== true)
  }

  // 1. Tab Filtering
  if (tab !== 'all' && tab !== 'test_orders') {
    const now = Date.now()
    list = list.filter((o) => {
      const isCancelled = isOrderCancelled(o)
      if (tab === 'cancelled') return isCancelled
      if (isCancelled) return false

      if (tab === 'new') {
        if (!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') {
          const ageInMs = now - new Date(o.created_at).getTime()
          const ageInDays = ageInMs / (1000 * 60 * 60 * 24)
          return ageInDays <= 2
        }
        return false
      }

      if (tab === 'ready_to_ship') {
        return isReadyToShipStatus(o)
      }

      if (tab === 'confirmed') {
        const source =
          filters.careConfirmSource === 'care_confirmed' ||
          filters.careConfirmSource === 'aisensy_confirmed'
            ? filters.careConfirmSource
            : 'all'
        return isConfirmedAwaitingShipment(o, undefined, source)
      }

      if (tab === 'in_transit') {
        return isShiprocketInTransitStatus(o)
      }
      if (tab === 'delivered') {
        return isShiprocketDeliveredStatus(o)
      }
      if (tab === 'rto') {
        return isActiveRtoStatus(o)
      }

      return false
    })
  }

  // 2. Search query filtering
  if (filters.search) {
    const q = filters.search.toLowerCase().trim()
    list = list.filter((o) => {
      const orderName = o.name?.toLowerCase() || ''
      const orderId = String(o.id || '')
      const customerName = o.customer
        ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.toLowerCase()
        : ''
      const customerEmail = o.customer?.email?.toLowerCase() || ''
      const phone = String(o.customer?.phone || o.shipping_address?.phone || '').toLowerCase()
      const awb = String(o.fulfillments?.[0]?.tracking_number || '').toLowerCase()

      return (
        orderName.includes(q) ||
        orderId.includes(q) ||
        customerName.includes(q) ||
        customerEmail.includes(q) ||
        phone.includes(q) ||
        awb.includes(q)
      )
    })
  }

  // 3. Financial Status
  if (filters.financial && filters.financial !== 'all') {
    const targetStatus = filters.financial.toLowerCase()
    list = list.filter((o) => (o.financial_status || '').toLowerCase() === targetStatus)
  }

  // 4. Payment Type — prefer Shiprocket payment_method over Shopify financial_status
  if (filters.paymentType && filters.paymentType !== 'all') {
    list = list.filter((o) => {
      const pm = String(o.payment_method || '').toLowerCase()
      let isCod: boolean
      if (pm.includes('cod')) isCod = true
      else if (pm.includes('prepaid') || pm.includes('pre-paid') || pm === 'online') isCod = false
      else isCod = o.financial_status?.toLowerCase() !== 'paid'

      const matchesCod = filters.paymentType === 'cod' && isCod
      const matchesPrepaid = filters.paymentType === 'prepaid' && !isCod
      return matchesCod || matchesPrepaid
    })
  }

  // 4b. Sales channel (Shopify vs Shiprocket-only) — mirrors Order Status
  if (filters.channel && filters.channel !== 'all') {
    list = list.filter((o) => {
      const isSrOnly = o.source === 'shiprocket'
      if (filters.channel === 'shiprocket') return isSrOnly
      if (filters.channel === 'shopify') return !isSrOnly
      return true
    })
  }

  // 5. Courier Partner
  if (filters.courier && filters.courier !== 'all') {
    const targetCourier = filters.courier.toLowerCase()
    list = list.filter((o) => {
      const activeCourier = o.fulfillments?.[0]?.tracking_company?.toLowerCase() || ''
      return activeCourier.includes(targetCourier)
    })
  }

  // 6. Pickup Location
  if (filters.pickupLocation && filters.pickupLocation !== 'all') {
    if (filters.pickupLocation !== 'primary') {
      return [] // mock pickup matching only 'primary'
    }
  }

  // 7. Weight Class
  if (filters.weightClass && filters.weightClass !== 'all') {
    list = list.filter(() => {
      const weight = 0.45 // Mock dead weight (0.45 kg)
      if (filters.weightClass === 'under_05') return weight < 0.5
      if (filters.weightClass === '05_to_1') return weight >= 0.5 && weight <= 1.0
      if (filters.weightClass === '1_to_2') return weight >= 1.0 && weight <= 2.0
      if (filters.weightClass === 'above_2') return weight > 2.0
      return true
    })
  }

  // 8. RTO Risk Level
  if (filters.rtoRisk && filters.rtoRisk !== 'all') {
    const targetRisk = filters.rtoRisk.toLowerCase()
    list = list.filter((o) => {
      const price = parseFloat(o.total_price)
      const isCod = o.financial_status?.toLowerCase() === 'pending'
      let risk = 'low risk'
      if (isCod && price > 1000) {
        risk = 'high risk'
      } else if (isCod) {
        risk = 'medium risk'
      }
      return risk.includes(targetRisk)
    })
  }

  // 9. Price boundaries
  if (filters.minPrice || filters.maxPrice) {
    list = list.filter((o) => {
      const price = parseFloat(o.total_price)
      if (isNaN(price)) return false
      if (filters.minPrice && price < parseFloat(filters.minPrice)) return false
      if (filters.maxPrice && price > parseFloat(filters.maxPrice)) return false
      return true
    })
  }

  // 10. Date boundaries & Presets (IST calendar days — same as Order Status / Shiprocket)
  const { start: resolvedStart, end: resolvedEnd } = resolveIstDateBounds({
    datePreset: filters.datePreset,
    startDate: filters.startDate,
    endDate: filters.endDate,
  })

  if (resolvedStart || resolvedEnd) {
    list = list.filter((o) => isCreatedInDateRange(o, resolvedStart, resolvedEnd))
  }

  // 11. Fulfillment Status Sub-status (normalized Shiprocket-aware labels)
  if (filters.fulfillmentStatus && filters.fulfillmentStatus !== 'all') {
    const targetLabel = filters.fulfillmentStatus.toLowerCase()
    list = list.filter((o) => {
      if (isOrderCancelled(o)) return targetLabel === 'cancelled'
      const status = normalizeShipmentStatus(o)
      const labelMap: Record<string, string> = {
        delivered: 'delivered',
        in_transit: 'in transit',
        out_for_delivery: 'out for delivery',
        failed: 'delivery failed',
        failure: 'delivery failed',
        rto: 'rto',
        rto_delivered: 'rto',
        attempted_delivery: 'attempted',
        pickup_scheduled: 'confirmed',
        ready_pickup: 'confirmed',
        confirmed: 'confirmed',
        unfulfilled: 'unfulfilled',
      }
      const label = labelMap[status] || status.replace(/_/g, ' ')
      return label === targetLabel
    })
  }

  return list
}

export function addOrderToCache(order: any) {
  if (cachedOrders) {
    if (!cachedOrders.some(o => String(o.id) === String(order.id))) {
      // Prepend and re-sort to maintain newest-first invariant
      cachedOrders = [order, ...cachedOrders].sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime()
        const dateB = new Date(b.created_at || 0).getTime()
        return dateB - dateA
      })
    }
  } else {
    cachedOrders = [order]
  }
}

/** Merge fields onto an existing cached order (keeps same id — no clone). */
export function patchOrderInCache(id: string | number, patch: Record<string, unknown>): any | null {
  if (!cachedOrders?.length) return null
  let updated: any | null = null
  cachedOrders = cachedOrders.map((o) => {
    if (String(o.id) !== String(id)) return o
    updated = { ...o, ...patch }
    return updated
  })
  return updated
}

export function toggleTestOrderInCache(id: string | number, isTest: boolean) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.map(o => {
      if (String(o.id) === String(id)) {
        return {
          ...o,
          is_test_order: isTest
        }
      }
      return o
    })
  }
}

export function updateOrderNoteInCache(id: string | number, note: string) {
  if (!cachedOrders) return
  cachedOrders = cachedOrders.map((o) =>
    String(o.id) === String(id) ? { ...o, note: note || null } : o,
  )
}

export type OrderStatusDeliveryFilter =
  | 'all'
  | 'delivered'
  | 'not_delivered'
  | 'in_transit'
  | 'out_for_delivery'
  | 'rto'
  | 'rto_delivered'
  | 'cancelled'
  | 'not_shipped'
  | 'ready_for_pickup'
  | 'delayed'
  | 'rto_alerts'
  | 'cod_not_confirmed'

export interface OrderStatusListFilters extends OrderFilters {
  deliveryStatus?: OrderStatusDeliveryFilter
  fulfillmentStatusUi?: string
  paymentStatusUi?: string
}

function orderPrice(order: any): number {
  const n = parseFloat(String(order?.total_price ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Order Status list: fold clones under parents, filter by ops status on the
 * live (clone) shipment, then paginate. Only the requested page is returned.
 */
export function getOrderStatusPaginated(
  page: number,
  perPage: number,
  filters: OrderStatusListFilters = {},
  sourceOrders?: any[] | null,
): {
  orders: any[]
  total: number
  page: number
  perPage: number
  totalPages: number
  couriers: string[]
  summary: {
    total: number
    delivered: number
    inTransit: number
    delayed: number
    rto: number
    cancelled: number
    notShipped: number
    readyForPickup: number
    codNotConfirmed: number
    values: {
      total: number
      delivered: number
      inTransit: number
      delayed: number
      rto: number
      cancelled: number
      notShipped: number
      readyForPickup: number
      codNotConfirmed: number
    }
  }
  channelBreakdown: { shopify: number; shiprocket: number }
} {
  // Date / channel / search only here — payment, courier, fulfillment, and
  // delivery cards use operational (clone-aware) matching below.
  const raw = getCachedOrdersFiltered({
    tab: 'all',
    includeTest: true,
    search: filters.search,
    channel: filters.channel,
    startDate: filters.startDate,
    endDate: filters.endDate,
    datePreset: filters.datePreset,
  }, sourceOrders)
  const byClean = new Map<string, any>()
  const clonesByParent = new Map<string, any[]>()

  for (const o of raw) {
    const clean = cleanOrderName(o.name)
    if (!clean) continue
    byClean.set(clean, o)
    const parentBase = getCloneParentBase(o.name)
    if (!parentBase) continue
    const list = clonesByParent.get(parentBase) || []
    list.push(o)
    clonesByParent.set(parentBase, list)
  }

  clonesByParent.forEach((list, key) => {
    list.sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    )
    clonesByParent.set(key, list)
  })

  // Parents only — clones with a known parent are folded into the parent card
  let parents = raw.filter((o) => {
    const parentBase = getCloneParentBase(o.name)
    return !(parentBase && byClean.has(parentBase))
  })

  const deliveryStatus = filters.deliveryStatus || 'all'
  const paymentStatus = filters.paymentStatusUi || 'all'
  const fulfillmentStatus = filters.fulfillmentStatusUi || 'all'

  const matchesRow = (o: any) => {
    const relatedClones = clonesByParent.get(cleanOrderName(o.name)) || []
    const live = getOperationalOrder(o, relatedClones)
    const status = normalizeShipmentStatus(live)
    const pay = paymentLabel(o)
    const company =
      live.fulfillments?.[0]?.tracking_company ||
      o.fulfillments?.[0]?.tracking_company ||
      ''
    const activeRto = trailHasActiveRto(o, relatedClones)

    if (filters.courier && filters.courier !== 'all' && company !== filters.courier) return false
    if (paymentStatus !== 'all' && pay.toLowerCase() !== paymentStatus) return false
    if (fulfillmentStatus !== 'all' && status !== fulfillmentStatus) return false

    if (deliveryStatus === 'delivered' && !isShiprocketDeliveredStatus(live)) return false
    if (deliveryStatus === 'not_delivered' && isShiprocketDeliveredStatus(live)) return false
    if (deliveryStatus === 'in_transit' && !isShiprocketInTransitStatus(live)) return false
    if (deliveryStatus === 'out_for_delivery' && status !== 'out_for_delivery') return false
    if (deliveryStatus === 'rto' && !activeRto) return false
    if (deliveryStatus === 'rto_delivered' && status !== 'rto_delivered') return false
    if (deliveryStatus === 'cancelled' && !isOrderCancelled(live)) return false
    if (deliveryStatus === 'not_shipped' && !isNotShippedBucket(o, live)) return false
    if (
      deliveryStatus === 'ready_for_pickup' &&
      (isOrderCancelled(live) || !isReadyForPickupStatus(live))
    ) {
      return false
    }
    // Delayed First: in-pipeline past ETD only — never open RTO (parent or clone)
    if (
      deliveryStatus === 'delayed' &&
      (isOrderCancelled(live) || activeRto || !isOrderDelayed(live))
    ) {
      return false
    }
    if (deliveryStatus === 'cod_not_confirmed' && !isCodNotConfirmed(o, live)) return false
    if (
      deliveryStatus === 'rto_alerts' &&
      !activeRto &&
      buildAlerts(live).length === 0
    ) {
      return false
    }
    if (
      deliveryStatus !== 'all' &&
      deliveryStatus !== 'cancelled' &&
      deliveryStatus !== 'cod_not_confirmed' &&
      isOrderCancelled(live)
    ) {
      return false
    }
    return true
  }

  // Summary uses the same base filters but ignores the quick deliveryStatus card
  const summaryBase = parents.filter((o) => {
    const relatedClones = clonesByParent.get(cleanOrderName(o.name)) || []
    const live = getOperationalOrder(o, relatedClones)
    const status = normalizeShipmentStatus(live)
    const pay = paymentLabel(o)
    const company =
      live.fulfillments?.[0]?.tracking_company ||
      o.fulfillments?.[0]?.tracking_company ||
      ''
    if (filters.courier && filters.courier !== 'all' && company !== filters.courier) return false
    if (paymentStatus !== 'all' && pay.toLowerCase() !== paymentStatus) return false
    if (fulfillmentStatus !== 'all' && status !== fulfillmentStatus) return false
    return true
  })

  const summary = {
    total: 0,
    delivered: 0,
    inTransit: 0,
    delayed: 0,
    rto: 0,
    cancelled: 0,
    notShipped: 0,
    readyForPickup: 0,
    codNotConfirmed: 0,
    values: {
      total: 0,
      delivered: 0,
      inTransit: 0,
      delayed: 0,
      rto: 0,
      cancelled: 0,
      notShipped: 0,
      readyForPickup: 0,
      codNotConfirmed: 0,
    },
  }

  for (const o of summaryBase) {
    const relatedClones = clonesByParent.get(cleanOrderName(o.name)) || []
    const live = getOperationalOrder(o, relatedClones)
    const price = orderPrice(o)
    const cancelled = isOrderCancelled(live)
    const activeRto = !cancelled && trailHasActiveRto(o, relatedClones)
    summary.total++
    summary.values.total += price
    if (cancelled) {
      summary.cancelled++
      summary.values.cancelled += price
      continue
    }
    if (isCodNotConfirmed(o, live)) {
      summary.codNotConfirmed++
      summary.values.codNotConfirmed += price
    }
    if (isNotShippedBucket(o, live)) {
      summary.notShipped++
      summary.values.notShipped += price
    }
    if (isReadyForPickupStatus(live)) {
      summary.readyForPickup++
      summary.values.readyForPickup += price
    }
    if (isShiprocketDeliveredStatus(live)) {
      summary.delivered++
      summary.values.delivered += price
    }
    if (isShiprocketInTransitStatus(live)) {
      summary.inTransit++
      summary.values.inTransit += price
    }
    if (activeRto) {
      summary.rto++
      summary.values.rto += price
    }
    if (!activeRto && !hasRtoInitiated(live) && isOrderDelayed(live)) {
      summary.delayed++
      summary.values.delayed += price
    }
  }

  let filtered = parents.filter(matchesRow)
  filtered = filtered.sort((a, b) => {
    if (deliveryStatus === 'delayed') {
      const aDays = getDelayDays(
        getOperationalOrder(a, clonesByParent.get(cleanOrderName(a.name)) || []),
      )
      const bDays = getDelayDays(
        getOperationalOrder(b, clonesByParent.get(cleanOrderName(b.name)) || []),
      )
      if (aDays !== bDays) return bDays - aDays
    }
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })

  const courierSet = new Set<string>()
  for (const o of summaryBase) {
    const relatedClones = clonesByParent.get(cleanOrderName(o.name)) || []
    const live = getOperationalOrder(o, relatedClones)
    const c =
      live.fulfillments?.[0]?.tracking_company || o.fulfillments?.[0]?.tracking_company
    if (c) courierSet.add(c)
  }

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / perPage) || 1)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * perPage
  const pageOrders = filtered.slice(start, start + perPage).map((o) => {
    const clean = cleanOrderName(o.name)
    const relatedClones = clonesByParent.get(clean) || []
    const parentBase = getCloneParentBase(o.name)
    const parent = parentBase ? byClean.get(parentBase) || null : null
    return {
      ...o,
      _related_clones: relatedClones,
      _parent: parent,
    }
  })

  let shopify = 0
  let shiprocket = 0
  for (const o of summaryBase) {
    if (o.source === 'shiprocket') shiprocket++
    else shopify++
  }

  return {
    orders: pageOrders,
    total,
    page: safePage,
    perPage,
    totalPages,
    couriers: Array.from(courierSet).sort(),
    summary,
    channelBreakdown: { shopify, shiprocket },
  }
}


