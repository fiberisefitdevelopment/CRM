/**
 * Match CRM orders to Aaysh Air Express by channel order id / Shopify name.
 * Cache has no airExpressOrderId until logistics sync runs — this index fills the gap.
 * Also carries AWB / courier / status so Order Status can leave "Not Shipped".
 */

import { listAayshOrders, listAayshShipments } from '@/src/services/aayshExpressClient'
import { cleanOrderChannelKey } from '@/src/services/orders/shiprocketMergeHelpers'

export type AirExpressLogistics = {
  aeOrderId: string
  awb: string | null
  courier: string | null
  shipmentId: string | null
  status: string | null
  pickupDate: string | null
}

export interface AirExpressMatchIndex {
  aeIdByKey: Map<string, string>
  logisticsByKey: Map<string, AirExpressLogistics>
  keys: Set<string>
  loadedAt: number
}

const CACHE_TTL_MS = 60_000

let cachedIndex: AirExpressMatchIndex | null = null
let loadPromise: Promise<AirExpressMatchIndex> | null = null

function normalizeAayshListResponse(data: unknown): any[] {
  const d = data as Record<string, unknown>
  if (Array.isArray(d?.data)) return d.data as any[]
  if (Array.isArray(d?.orders)) return d.orders as any[]
  if (Array.isArray(d?.shipments)) return d.shipments as any[]
  if (Array.isArray(data)) return data as any[]
  return []
}

function extractAeOrderId(row: any): string | null {
  const id =
    row?.order_id ??
    row?.orderId ??
    row?.externalOrderId ??
    row?.external_order_id ??
    row?.shipment_id ??
    row?.id
  if (id == null) return null
  const s = String(id).trim()
  return s || null
}

function extractAwb(row: any): string | null {
  const awb =
    row?.awbNumber ??
    row?.awb_number ??
    row?.awb ??
    row?.awb_code ??
    row?.last_mile_awb ??
    row?.shipment?.awb ??
    row?.shipment?.awbNumber ??
    row?.shipment?.awb_code ??
    row?.shipments?.[0]?.awb ??
    row?.shipments?.[0]?.awbNumber
  const s = String(awb || '').trim()
  return s || null
}

function extractCourier(row: any): string | null {
  const c =
    row?.courierName ??
    row?.courier_name ??
    row?.courier ??
    row?.shipment?.courier ??
    row?.shipment?.courierName
  const s = String(c || '').trim()
  return s || null
}

function extractShipmentId(row: any): string | null {
  const id =
    row?.shipmentId ??
    row?.shipment_id ??
    row?.shipment?.shipment_id ??
    row?.shipment?.id
  const s = id != null ? String(id).trim() : ''
  return s || null
}

function extractStatus(row: any): string | null {
  const s = String(
    row?.shippingStatus ??
      row?.shipping_status ??
      row?.status ??
      row?.shipment?.status ??
      '',
  ).trim()
  return s || null
}

function extractPickupDate(row: any): string | null {
  const d = row?.pickupDate ?? row?.pickup_date ?? row?.shipment?.pickup_date
  const s = d != null ? String(d).trim() : ''
  return s || null
}

function channelKeysForRow(row: any): string[] {
  return [
    row?.order_id,
    row?.orderId,
    row?.externalOrderId,
    row?.external_order_id,
    row?.channel_order_id,
    row?.channelOrderId,
    row?.reference,
    row?.name,
  ]
    .map(cleanOrderChannelKey)
    .filter(Boolean)
}

/** Map Aaysh shipping status → CRM shipment_status used by Order Status cards. */
export function mapAayshStatusToShipmentStatus(status?: string | null, hasAwb?: boolean): string {
  const s = String(status || '')
    .toLowerCase()
    .trim()
  if (!s && hasAwb) return 'pickup_scheduled'
  if (s.includes('deliver')) return 'delivered'
  if (s.includes('rto') || s.includes('return')) return 'rto'
  if (s.includes('out for delivery') || s === 'ofd') return 'out_for_delivery'
  if (s.includes('transit') || s === 'shipped') return 'in_transit'
  if (s.includes('cancel')) return 'cancelled'
  if (s.includes('book') || s.includes('pickup') || s === 'pending') {
    return hasAwb ? 'pickup_scheduled' : 'processing'
  }
  return hasAwb ? 'pickup_scheduled' : 'processing'
}

function mergeLogistics(
  prev: AirExpressLogistics | undefined,
  next: AirExpressLogistics,
): AirExpressLogistics {
  if (!prev) return next
  // Prefer rows that already have an AWB / richer courier data
  const prevScore = (prev.awb ? 2 : 0) + (prev.courier ? 1 : 0) + (prev.shipmentId ? 1 : 0)
  const nextScore = (next.awb ? 2 : 0) + (next.courier ? 1 : 0) + (next.shipmentId ? 1 : 0)
  return nextScore >= prevScore ? { ...prev, ...next, awb: next.awb || prev.awb } : prev
}

function addRowToIndex(index: AirExpressMatchIndex, row: any) {
  const aeId = extractAeOrderId(row)
  const awb = extractAwb(row)
  const courier = extractCourier(row)
  const shipmentId = extractShipmentId(row)
  const status = extractStatus(row)
  const pickupDate = extractPickupDate(row)

  for (const cleaned of channelKeysForRow(row)) {
    index.keys.add(cleaned)
    if (aeId && !index.aeIdByKey.has(cleaned)) {
      index.aeIdByKey.set(cleaned, aeId)
    }
    if (aeId || awb) {
      const logistics: AirExpressLogistics = {
        aeOrderId: aeId || cleaned,
        awb,
        courier,
        shipmentId,
        status,
        pickupDate,
      }
      index.logisticsByKey.set(
        cleaned,
        mergeLogistics(index.logisticsByKey.get(cleaned), logistics),
      )
    }
  }
}

async function fetchAllPages(
  fetchPage: (page: number) => Promise<unknown>,
  maxPages = 50,
): Promise<any[]> {
  const all: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page)
    const list = normalizeAayshListResponse(res)
    if (!list.length) break
    all.push(...list)
    if (list.length < 100) break
  }
  return all
}

async function buildIndex(): Promise<AirExpressMatchIndex> {
  const index: AirExpressMatchIndex = {
    aeIdByKey: new Map(),
    logisticsByKey: new Map(),
    keys: new Set(),
    loadedAt: Date.now(),
  }

  const [orders, shipments] = await Promise.all([
    fetchAllPages((page) => listAayshOrders({ page, per_page: 100, sort: 'DESC' })).catch(
      () => [],
    ),
    fetchAllPages((page) => listAayshShipments({ page, per_page: 100, sort: 'DESC' })).catch(
      () => [],
    ),
  ])

  for (const row of [...orders, ...shipments]) {
    addRowToIndex(index, row)
  }

  const withAwb = [...index.logisticsByKey.values()].filter((l) => l.awb).length
  console.log(
    `✈️ Air Express match index: ${index.keys.size} keys, ${withAwb} with AWB (${orders.length} orders, ${shipments.length} shipments)`,
  )
  return index
}

/** In-memory index of Aaysh order ids keyed by Shopify order name / id. */
export async function loadAirExpressMatchIndex(options?: {
  force?: boolean
}): Promise<AirExpressMatchIndex> {
  const now = Date.now()
  if (!options?.force && cachedIndex && now - cachedIndex.loadedAt < CACHE_TTL_MS) {
    return cachedIndex
  }
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      cachedIndex = await buildIndex()
      return cachedIndex
    } catch (e) {
      console.warn('⚠️ Air Express index load failed:', (e as Error)?.message || e)
      if (cachedIndex) return cachedIndex
      return {
        aeIdByKey: new Map(),
        logisticsByKey: new Map(),
        keys: new Set(),
        loadedAt: Date.now(),
      }
    } finally {
      loadPromise = null
    }
  })()

  return loadPromise
}

export function crmOrderKeys(order: any): string[] {
  return [
    cleanOrderChannelKey(order?.name),
    order?.id != null ? String(order.id) : '',
    cleanOrderChannelKey(order?.order_id),
  ].filter(Boolean)
}

export function crmOrderMatchesAirExpress(
  order: any,
  index?: AirExpressMatchIndex | null,
): boolean {
  if (!order || !index?.keys.size) return false
  return crmOrderKeys(order).some((k) => index.keys.has(k))
}

export function resolveAirExpressIdForOrder(
  order: any,
  index?: AirExpressMatchIndex | null,
): string | null {
  if (!order || !index) return null
  for (const k of crmOrderKeys(order)) {
    if (index.keys.has(k)) {
      return index.aeIdByKey.get(k) || k
    }
  }
  return null
}

export function resolveAirExpressLogisticsForOrder(
  order: any,
  index?: AirExpressMatchIndex | null,
): AirExpressLogistics | null {
  if (!order || !index?.logisticsByKey.size) return null
  for (const k of crmOrderKeys(order)) {
    const hit = index.logisticsByKey.get(k)
    if (hit) return hit
  }
  return null
}

/**
 * Stamp airExpressOrderId + fulfillments/AWB from live Aaysh index so
 * Not Shipped / Ready for Pickup / In Transit cards bucket correctly.
 */
export function enrichOrderWithAirExpress(
  order: any,
  index?: AirExpressMatchIndex | null,
): any {
  if (!order) return order

  const logistics = resolveAirExpressLogisticsForOrder(order, index)
  const existingAe = String(order.airExpressOrderId ?? order.air_express_order_id ?? '').trim()
  const aeId = existingAe || logistics?.aeOrderId || resolveAirExpressIdForOrder(order, index)

  if (!aeId && !logistics) return order

  const existingAwb = String(
    order?.fulfillments?.[0]?.tracking_number ||
      order?.fulfillments?.[0]?.awb ||
      order?.awb ||
      '',
  ).trim()
  const awb = logistics?.awb || existingAwb || null
  const hasAwb = Boolean(awb)
  const shipmentStatus = mapAayshStatusToShipmentStatus(logistics?.status, hasAwb)
  const courier = logistics?.courier || order?.fulfillments?.[0]?.tracking_company || 'Air Express'

  let next = { ...order }
  if (aeId) next.airExpressOrderId = aeId
  if (logistics?.shipmentId) next.airExpressShipmentId = logistics.shipmentId

  // Only overwrite empty / AE-shaped fulfillments — don't clobber a real Shiprocket AWB.
  const existingCompany = String(order?.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  const canStampFulfillment =
    !existingAwb ||
    existingCompany.includes('air express') ||
    existingCompany.includes('aaysh') ||
    existingCompany.includes('trackon') ||
    Boolean(order.airExpressOrderId || order.logistics === 'air_express')

  if (canStampFulfillment && (hasAwb || aeId || logistics)) {
    const nowIso = new Date().toISOString()
    // Booked on Air Express without AWB still left "Not Shipped" as `processing`.
    const effectiveStatus =
      shipmentStatus === 'processing' && (aeId || logistics) ? 'pickup_scheduled' : shipmentStatus
    next = {
      ...next,
      fulfillment_status: 'fulfilled',
      logistics: next.logistics || 'air_express',
      fulfillments: [
        {
          ...(order.fulfillments?.[0] || {}),
          id: Number(logistics?.shipmentId) || order.fulfillments?.[0]?.id || Date.now(),
          status: 'success',
          tracking_number: awb,
          tracking_company: courier,
          shipment_status: effectiveStatus,
          shipment_status_reason:
            logistics?.status || (hasAwb ? 'AWB assigned' : 'Booked on Air Express'),
          created_at: order.fulfillments?.[0]?.created_at || nowIso,
          dispatch_date: logistics?.pickupDate || order.fulfillments?.[0]?.dispatch_date || nowIso,
          delivery_date: order.fulfillments?.[0]?.delivery_date || null,
        },
      ],
    }
  } else if (aeId && !order.airExpressOrderId) {
    next = { ...next, airExpressOrderId: aeId }
  }

  return next
}

/** Test helper — reset in-memory cache between tests. */
export function resetAirExpressMatchIndexCache() {
  cachedIndex = null
  loadPromise = null
}
