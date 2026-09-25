/**
 * Match CRM orders to Shipway by channel order id (Shopify order name / number).
 * Orders shipped from the Shipway panel are not in CRM until this index enriches them.
 */

import { listShipwayOrders, type ShipwayListOrder } from '@/src/services/shipwayClient'
import { cleanOrderChannelKey } from '@/src/services/orders/shiprocketMergeHelpers'
function isShipwayOrderLocal(order: any): boolean {
  if (!order) return false
  if (order.logistics === 'shipway') return true
  const id = order.shipwayOrderId ?? order.shipway_order_id
  if (id != null && String(id).trim() !== '') return true
  const company = String(order.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  return company.includes('shipway')
}

export type ShipwayLogistics = {
  shipwayOrderId: string
  awb: string | null
  courier: string | null
  carrierId: string | number | null
  statusCode: string | null
  statusName: string | null
  orderDate: string | null
}

export interface ShipwayMatchIndex {
  shipwayIdByKey: Map<string, string>
  logisticsByKey: Map<string, ShipwayLogistics>
  keys: Set<string>
  loadedAt: number
}

const CACHE_TTL_MS = 5 * 60_000
const STALE_OK_MS = 30 * 60_000

let revalidateScheduled = false

let cachedIndex: ShipwayMatchIndex | null = null
let loadPromise: Promise<ShipwayMatchIndex> | null = null

export function mapShipwayStatusToShipmentStatus(
  code?: string | null,
  name?: string | null,
  hasAwb?: boolean,
): string {
  const c = String(code || '').toUpperCase().trim()
  const n = String(name || '').toLowerCase().trim()
  if (c === 'DEL' || n.includes('delivered')) return 'delivered'
  if (c === 'RTO' || n.includes('rto')) return 'rto'
  if (c === 'OOD' || n.includes('out for delivery')) return 'out_for_delivery'
  if (c === 'INT' || c === 'RAD' || n.includes('in transit') || n.includes('destination hub')) {
    return 'in_transit'
  }
  if (c === 'UND' || n.includes('undelivered')) return 'attempted_delivery'
  if (
    c === 'OFP' ||
    c === 'NFI' ||
    n.includes('pickup') ||
    n.includes('awb assigned')
  ) {
    return hasAwb ? 'pickup_scheduled' : 'processing'
  }
  if (c === 'PKF' || n.includes('exception')) return 'processing'
  return hasAwb ? 'pickup_scheduled' : 'processing'
}

function channelKeysForRow(row: ShipwayListOrder): string[] {
  return [row.order_id, row.invoice_number]
    .map(cleanOrderChannelKey)
    .filter(Boolean)
}

function mergeLogistics(prev: ShipwayLogistics | undefined, next: ShipwayLogistics): ShipwayLogistics {
  if (!prev) return next
  const prevScore = (prev.awb ? 2 : 0) + (prev.courier ? 1 : 0)
  const nextScore = (next.awb ? 2 : 0) + (next.courier ? 1 : 0)
  return nextScore >= prevScore ? { ...prev, ...next, awb: next.awb || prev.awb } : prev
}

function rowToLogistics(row: ShipwayListOrder): ShipwayLogistics {
  const shipwayOrderId = String(row.order_id || '').trim()
  const awb = String(row.tracking_number || '').trim() || null
  const courier =
    String(row.carrier_title || row.name || '').trim() || 'Shipway Partner'
  return {
    shipwayOrderId,
    awb,
    courier,
    carrierId: row.carrier_id ?? null,
    statusCode: row.shipment_status ?? null,
    statusName: row.shipment_status_name ?? null,
    orderDate: row.order_date ?? null,
  }
}

function addRowToIndex(index: ShipwayMatchIndex, row: ShipwayListOrder) {
  const logistics = rowToLogistics(row)
  if (!logistics.shipwayOrderId) return

  for (const cleaned of channelKeysForRow(row)) {
    index.keys.add(cleaned)
    if (!index.shipwayIdByKey.has(cleaned)) {
      index.shipwayIdByKey.set(cleaned, logistics.shipwayOrderId)
    }
    index.logisticsByKey.set(
      cleaned,
      mergeLogistics(index.logisticsByKey.get(cleaned), logistics),
    )
  }
}

async function fetchAllShipwayOrders(): Promise<ShipwayListOrder[]> {
  const all: ShipwayListOrder[] = []
  for (let page = 1; page <= 50; page++) {
    const resp = await listShipwayOrders(page)
    const msg = resp?.message
    if (!msg || typeof msg === 'string') break
    if (!Array.isArray(msg) || msg.length === 0) break
    all.push(...msg)
    if (msg.length < 25) break
  }
  return all
}

async function buildIndex(): Promise<ShipwayMatchIndex> {
  const index: ShipwayMatchIndex = {
    shipwayIdByKey: new Map(),
    logisticsByKey: new Map(),
    keys: new Set(),
    loadedAt: Date.now(),
  }

  const rows = await fetchAllShipwayOrders()
  for (const row of rows) {
    addRowToIndex(index, row)
  }

  const withAwb = [...index.logisticsByKey.values()].filter((l) => l.awb).length
  console.log(
    `📦 Shipway match index: ${index.keys.size} keys, ${withAwb} with AWB (${rows.length} orders)`,
  )
  return index
}

function scheduleShipwayRevalidate() {
  if (revalidateScheduled || loadPromise) return
  revalidateScheduled = true
  void loadShipwayMatchIndex({ force: true }).finally(() => {
    revalidateScheduled = false
  })
}

export async function loadShipwayMatchIndex(options?: {
  force?: boolean
}): Promise<ShipwayMatchIndex> {
  const now = Date.now()
  if (!options?.force && cachedIndex) {
    const age = now - cachedIndex.loadedAt
    if (age < CACHE_TTL_MS) return cachedIndex
    if (age < STALE_OK_MS) {
      scheduleShipwayRevalidate()
      return cachedIndex
    }
  }
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      cachedIndex = await buildIndex()
      return cachedIndex
    } catch (e) {
      console.warn('⚠️ Shipway index load failed:', (e as Error)?.message || e)
      if (cachedIndex) return cachedIndex
      return {
        shipwayIdByKey: new Map(),
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
    cleanOrderChannelKey(order?.shipwayOrderId),
  ].filter(Boolean)
}

export function crmOrderMatchesShipway(
  order: any,
  index?: ShipwayMatchIndex | null,
): boolean {
  if (!order) return false
  if (isShipwayOrderLocal(order)) return true
  if (!index?.keys.size) return false
  return crmOrderKeys(order).some((k) => index.keys.has(k))
}

export function resolveShipwayLogisticsForOrder(
  order: any,
  index?: ShipwayMatchIndex | null,
): ShipwayLogistics | null {
  if (!order || !index?.logisticsByKey.size) return null
  for (const k of crmOrderKeys(order)) {
    const hit = index.logisticsByKey.get(k)
    if (hit) return hit
  }
  return null
}

/**
 * Stamp shipwayOrderId + fulfillments/AWB from live Shipway index.
 */
export function enrichOrderWithShipway(order: any, index?: ShipwayMatchIndex | null): any {
  if (!order) return order

  const logistics = resolveShipwayLogisticsForOrder(order, index)
  const existingId = String(order.shipwayOrderId ?? order.shipway_order_id ?? '').trim()
  const shipwayOrderId =
    existingId || logistics?.shipwayOrderId || null

  if (!shipwayOrderId && !logistics) return order

  const existingAwb = String(
    order?.fulfillments?.[0]?.tracking_number ||
      order?.fulfillments?.[0]?.awb ||
      order?.awb ||
      '',
  ).trim()
  const awb = logistics?.awb || existingAwb || null
  const hasAwb = Boolean(awb)
  const shipmentStatus = mapShipwayStatusToShipmentStatus(
    logistics?.statusCode,
    logistics?.statusName,
    hasAwb,
  )
  const courier =
    logistics?.courier || order?.fulfillments?.[0]?.tracking_company || 'Shipway Partner'
  const trackingUrl = awb ? `https://fiberisefit.shipway.com/t/${awb}` : null

  const existingCompany = String(order?.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  const isShipwayTrail =
    isShipwayOrderLocal(order) ||
    Boolean(logistics) ||
    existingCompany.includes('shipway')

  const canStampFulfillment =
    isShipwayTrail &&
    (!existingAwb ||
      existingCompany.includes('shipway') ||
      Boolean(logistics) ||
      order.logistics === 'shipway')

  let next = { ...order }
  if (shipwayOrderId) {
    next.shipwayOrderId = shipwayOrderId
    next.logistics = 'shipway'
  }
  if (logistics?.carrierId != null) {
    next.shipwayCarrierId = logistics.carrierId
  }

  if (canStampFulfillment && (hasAwb || shipwayOrderId || logistics)) {
    const nowIso = new Date().toISOString()
    const effectiveStatus =
      shipmentStatus === 'processing' && (shipwayOrderId || logistics)
        ? 'pickup_scheduled'
        : shipmentStatus
    next = {
      ...next,
      fulfillment_status: effectiveStatus === 'delivered' ? 'fulfilled' : next.fulfillment_status,
      fulfillments: [
        {
          ...(order.fulfillments?.[0] || {}),
          id: order.fulfillments?.[0]?.id || Date.now(),
          status: 'success',
          tracking_number: awb,
          tracking_company: courier,
          tracking_url: trackingUrl || order.fulfillments?.[0]?.tracking_url || null,
          shipment_status: effectiveStatus,
          shipment_status_reason:
            logistics?.statusName || (hasAwb ? 'AWB assigned via Shipway' : 'Booked on Shipway'),
          created_at: logistics?.orderDate || order.fulfillments?.[0]?.created_at || nowIso,
          dispatch_date: order.fulfillments?.[0]?.dispatch_date || logistics?.orderDate || nowIso,
          delivery_date:
            effectiveStatus === 'delivered'
              ? order.fulfillments?.[0]?.delivery_date || nowIso
              : order.fulfillments?.[0]?.delivery_date || null,
        },
      ],
      shipment_status: effectiveStatus,
      tracking_number: awb,
      tracking_url: trackingUrl,
      awb,
    }
  }

  return next
}

export function resetShipwayMatchIndexCache() {
  cachedIndex = null
  loadPromise = null
}
