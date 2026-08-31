/**
 * Phase 4 — Incremental Shiprocket / Air Express → Firestore logistics sync.
 *
 * Merge-writes logistics fields only. Never touches Shopify-owned commerce fields.
 * Gated by ORDERS_WRITE_TO_FIRESTORE. Does not enable Firestore reads for the app.
 */

import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { getRecentShiprocketOrders } from '@/src/services/shiprocketClient'
import { listAayshOrders, listAayshShipments } from '@/src/services/aayshExpressClient'
import { isOrdersWriteToFirestoreEnabled } from '@/src/services/orders/shopifyFirestoreUpsert'
import {
  buildShopifyOrderLookupMap,
  cleanOrderChannelKey,
  extractShiprocketLogistics,
  isShiprocketStatusInSyncScope,
  matchShiprocketToShopify,
  normalizeShiprocketShipmentStatus,
} from '@/src/services/orders/shiprocketMergeHelpers'
import { getCachedOrders } from '@/src/services/ordersCache'

const COLLECTION = 'orders'
const DEFAULT_LOOKBACK_DAYS = 14
const RECENT_DELIVERED_DAYS = 7

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function stripUndefined<T>(value: T): T {
  if (value === undefined) return null as unknown as T
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = stripUndefined(v)
  }
  return out as T
}

/**
 * Logistics-only Firestore merge payload from Shiprocket.
 * Intentionally omits payment_method, financial_status, customer, line_items, etc.
 */
export function buildShiprocketLogisticsMergePayload(
  srOrder: any,
  matchedShopifyCreatedAt?: string | null,
  nowIso: string = new Date().toISOString(),
): Record<string, any> {
  const logistics = extractShiprocketLogistics(srOrder)
  const baseFulfillment = logistics.enrichmentFulfillment
  const fulfillment: Record<string, any> | null = baseFulfillment
    ? {
        ...baseFulfillment,
        created_at:
          baseFulfillment.created_at ||
          matchedShopifyCreatedAt ||
          logistics.srCreatedAt,
      }
    : null

  const payload: Record<string, any> = {
    shiprocket_order_id: logistics.shiprocket_order_id,
    shiprocketOrderId: logistics.shiprocket_order_id,
    shiprocket_meta: logistics.shiprocket_meta,
    shiprocketUpdatedAt: logistics.srUpdatedAt || nowIso,
    updatedAt: nowIso,
  }

  if (fulfillment) {
    payload.fulfillments = [fulfillment]
    // Convenience top-level mirrors (allowed logistics fields)
    payload.shipment_status = fulfillment.shipment_status
    payload.tracking_number = fulfillment.tracking_number
    payload.tracking_url = fulfillment.tracking_url
    payload.awb = fulfillment.tracking_number
  }

  return stripUndefined(payload)
}

/** Resolve Firestore doc id using the same matching keys as the cache merge. */
export function resolveFirestoreDocIdForShiprocket(
  srOrder: any,
  shopifyMap: Map<string, any>,
): string | null {
  const matched = matchShiprocketToShopify(srOrder, shopifyMap)
  if (matched?.id != null) return String(matched.id)
  if (srOrder?.id != null) return String(srOrder.id)
  return null
}

export interface LogisticsSyncResult {
  skipped: boolean
  reason?: string
  shiprocket: {
    fetched: number
    inScope: number
    written: number
    failed: number
    failures: Array<{ docId: string; error: string }>
  }
  airExpress: {
    fetched: number
    inScope: number
    written: number
    failed: number
    failures: Array<{ docId: string; error: string }>
    note: string
  }
}

function isAirExpressStatusInSyncScope(statusRaw: string, updatedAt?: string | null): boolean {
  const s = String(statusRaw || '').toLowerCase()
  if (!s) return true
  if (s.includes('cancel')) return false

  const delivered =
    s.includes('delivered') || s.includes('rto delivered') || s.includes('rto_delivered')
  if (delivered) {
    if (!updatedAt) return true
    const ageMs = Date.now() - new Date(updatedAt).getTime()
    if (Number.isNaN(ageMs)) return true
    return ageMs <= RECENT_DELIVERED_DAYS * 24 * 60 * 60 * 1000
  }

  // Pending / confirmed / shipped / transit / OFD / pickup / new…
  return true
}

function buildAirExpressLogisticsMergePayload(
  aeOrder: any,
  aeShipment: any | null,
  nowIso: string,
): Record<string, any> {
  const awb =
    aeShipment?.awb ||
    aeShipment?.awbNumber ||
    aeOrder?.awb ||
    aeOrder?.awbNumber ||
    null
  const trackingUrl =
    aeShipment?.trackingUrl ||
    aeShipment?.tracking_url ||
    aeOrder?.trackingUrl ||
    aeOrder?.tracking_url ||
    null
  const courier =
    aeShipment?.courierName ||
    aeShipment?.courier ||
    aeOrder?.courierName ||
    aeOrder?.courier ||
    null
  const statusRaw =
    aeShipment?.status ||
    aeShipment?.shipmentStatus ||
    aeOrder?.status ||
    aeOrder?.orderStatus ||
    ''
  const shipment_status =
    normalizeShiprocketShipmentStatus(String(statusRaw)) ||
    (statusRaw ? String(statusRaw).toLowerCase().replace(/\s+/g, '_') : null)

  const aeId =
    aeOrder?.id ||
    aeOrder?._id ||
    aeOrder?.orderId ||
    aeOrder?.order_id ||
    aeShipment?.orderId ||
    null

  const shipmentId =
    aeShipment?.shipment_id ||
    aeShipment?.shipmentId ||
    aeShipment?.id ||
    aeOrder?.shipment_id ||
    aeOrder?.shipmentId ||
    aeOrder?.shipment?.shipment_id ||
    null

  const payload: Record<string, any> = {
    airExpressOrderId: aeId != null ? String(aeId) : null,
    airExpressShipmentId: shipmentId != null ? String(shipmentId) : null,
    logistics: 'air_express',
    airExpressUpdatedAt: nowIso,
    updatedAt: nowIso,
  }

  if (awb || shipment_status) {
    payload.fulfillments = [
      {
        id: shipmentId || aeShipment?.id || aeShipment?._id || Math.floor(Math.random() * 10000),
        status: 'success',
        tracking_number: awb,
        tracking_company: courier,
        tracking_url: trackingUrl,
        shipment_status,
        shipment_status_reason: aeShipment?.delayReason || aeOrder?.delayReason || null,
        created_at: aeOrder?.createdAt || aeOrder?.orderDate || nowIso,
        dispatch_date: aeShipment?.pickupDate || aeOrder?.pickupDate || null,
        delivery_date: aeShipment?.deliveredAt || aeOrder?.deliveredAt || null,
      },
    ]
    payload.shipment_status = shipment_status
    payload.tracking_number = awb
    payload.tracking_url = trackingUrl
    payload.awb = awb
  }

  return stripUndefined(payload)
}

function resolveFirestoreDocIdForAirExpress(
  aeOrder: any,
  shopifyMap: Map<string, any>,
): string | null {
  const channelKeys = [
    aeOrder?.order_id,
    aeOrder?.orderId,
    aeOrder?.channel_order_id,
    aeOrder?.channelOrderId,
    aeOrder?.reference,
    aeOrder?.name,
  ]
  for (const key of channelKeys) {
    const cleaned = cleanOrderChannelKey(key)
    if (!cleaned) continue
    const matched = shopifyMap.get(cleaned)
    if (matched?.id != null) return String(matched.id)
    // If key itself looks like a Firestore/Shopify id already in map
    if (shopifyMap.has(String(key))) return String(matched?.id ?? key)
  }

  // Fallback: doc id = cleaned order_id when present
  const fallback = cleanOrderChannelKey(aeOrder?.order_id || aeOrder?.orderId)
  return fallback || null
}

async function mergeWriteLogistics(docId: string, payload: Record<string, any>) {
  const ref = getDb().collection(COLLECTION).doc(docId)
  await ref.set(payload, { merge: true })
}

/**
 * Run incremental logistics sync into Firestore.
 * Matching uses the in-memory/disk orders cache (same keys as the live merge).
 */
export async function syncLogisticsToFirestore(options?: {
  lookbackDays?: number
}): Promise<LogisticsSyncResult> {
  if (!isOrdersWriteToFirestoreEnabled()) {
    return {
      skipped: true,
      reason: 'ORDERS_WRITE_TO_FIRESTORE disabled',
      shiprocket: { fetched: 0, inScope: 0, written: 0, failed: 0, failures: [] },
      airExpress: {
        fetched: 0,
        inScope: 0,
        written: 0,
        failed: 0,
        failures: [],
        note: 'skipped — write flag off',
      },
    }
  }

  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const cached = getCachedOrders() || []
  const shopifyMap = buildShopifyOrderLookupMap(cached)

  const result: LogisticsSyncResult = {
    skipped: false,
    shiprocket: { fetched: 0, inScope: 0, written: 0, failed: 0, failures: [] },
    airExpress: {
      fetched: 0,
      inScope: 0,
      written: 0,
      failed: 0,
      failures: [],
      note:
        'Air Express has no webhook integration in this CRM — incremental polling via listOrders/listShipments only.',
    },
  }

  // ── Shiprocket ──────────────────────────────────────────────────────────
  const srOrders = await getRecentShiprocketOrders(lookbackDays)
  result.shiprocket.fetched = srOrders.length

  for (const srOrder of srOrders) {
    if (!isShiprocketStatusInSyncScope(srOrder, RECENT_DELIVERED_DAYS)) continue
    result.shiprocket.inScope++

    const docId = resolveFirestoreDocIdForShiprocket(srOrder, shopifyMap)
    if (!docId) continue

    const matched = matchShiprocketToShopify(srOrder, shopifyMap)
    const payload = buildShiprocketLogisticsMergePayload(srOrder, matched?.created_at || null)

    try {
      await mergeWriteLogistics(docId, payload)
      result.shiprocket.written++
    } catch (e: any) {
      result.shiprocket.failed++
      result.shiprocket.failures.push({ docId, error: e?.message || String(e) })
    }
  }

  // ── Air Express (polling only — no webhooks in this codebase) ───────────
  try {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - lookbackDays)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = to.toISOString().slice(0, 10)

    const [ordersRes, shipmentsRes] = await Promise.all([
      listAayshOrders({
        from: fromStr,
        to: toStr,
        per_page: 100,
        page: 1,
        sort: 'DESC',
        sort_by: 'createdAt',
      }).catch((e) => {
        console.warn('⚠️ Air Express listOrders failed:', e?.message || e)
        return null
      }),
      listAayshShipments({
        from: fromStr,
        to: toStr,
        per_page: 100,
        page: 1,
        sort: 'DESC',
        sort_by: 'createdAt',
      }).catch((e) => {
        console.warn('⚠️ Air Express listShipments failed:', e?.message || e)
        return null
      }),
    ])

    const aeOrders: any[] = Array.isArray(ordersRes?.data)
      ? ordersRes.data
      : Array.isArray(ordersRes?.orders)
        ? ordersRes.orders
        : Array.isArray(ordersRes)
          ? ordersRes
          : []
    const aeShipments: any[] = Array.isArray(shipmentsRes?.data)
      ? shipmentsRes.data
      : Array.isArray(shipmentsRes?.shipments)
        ? shipmentsRes.shipments
        : Array.isArray(shipmentsRes)
          ? shipmentsRes
          : []

    result.airExpress.fetched = aeOrders.length + aeShipments.length

    const shipmentsByOrder = new Map<string, any>()
    for (const sh of aeShipments) {
      const key = cleanOrderChannelKey(
        sh?.order_id || sh?.orderId || sh?.channel_order_id || sh?.orderNumber,
      )
      if (key) shipmentsByOrder.set(key, sh)
    }

    const nowIso = new Date().toISOString()
    for (const aeOrder of aeOrders) {
      const status =
        aeOrder?.status || aeOrder?.orderStatus || aeOrder?.shipmentStatus || ''
      const updated =
        aeOrder?.updatedAt || aeOrder?.updated_at || aeOrder?.deliveredAt || null
      if (!isAirExpressStatusInSyncScope(String(status), updated)) continue
      result.airExpress.inScope++

      const docId = resolveFirestoreDocIdForAirExpress(aeOrder, shopifyMap)
      if (!docId) continue

      const channelKey = cleanOrderChannelKey(
        aeOrder?.order_id || aeOrder?.orderId || aeOrder?.channel_order_id,
      )
      const shipment = channelKey ? shipmentsByOrder.get(channelKey) || null : null
      const payload = buildAirExpressLogisticsMergePayload(aeOrder, shipment, nowIso)

      try {
        await mergeWriteLogistics(docId, payload)
        result.airExpress.written++
      } catch (e: any) {
        result.airExpress.failed++
        result.airExpress.failures.push({ docId, error: e?.message || String(e) })
      }
    }

    // Shipments without a matching order row still try match by their own order_id
    for (const sh of aeShipments) {
      const status = sh?.status || sh?.shipmentStatus || ''
      const updated = sh?.updatedAt || sh?.deliveredAt || null
      if (!isAirExpressStatusInSyncScope(String(status), updated)) continue

      const fakeOrder = {
        order_id: sh?.order_id || sh?.orderId || sh?.channel_order_id,
        id: sh?.orderId || sh?.order_id,
        status,
      }
      const docId = resolveFirestoreDocIdForAirExpress(fakeOrder, shopifyMap)
      if (!docId) continue

      // Skip if we already wrote this doc from orders loop with same AE id — still idempotent merge
      const payload = buildAirExpressLogisticsMergePayload(fakeOrder, sh, nowIso)
      try {
        await mergeWriteLogistics(docId, payload)
        result.airExpress.written++
        result.airExpress.inScope++
      } catch (e: any) {
        result.airExpress.failed++
        result.airExpress.failures.push({ docId, error: e?.message || String(e) })
      }
    }
  } catch (e: any) {
    result.airExpress.note += ` Error: ${e?.message || e}`
  }

  return result
}
