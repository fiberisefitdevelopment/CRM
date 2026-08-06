/**
 * Shared Shiprocket ↔ Shopify matching + logistics enrichment.
 *
 * Extracted from the existing `/api/shopify/orders` merge so Phase 4 sync
 * reuses the same rules (no second matching algorithm).
 */

import { parseShiprocketDate } from '@/src/utils/orderPayment'

/** Same keying as the live merge: strip `#`, trim, lower-case. */
export function cleanOrderChannelKey(value: string | number | null | undefined): string {
  return String(value || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
}

/**
 * Build lookup map used by the existing merge:
 * - order.name (cleaned) → order
 * - String(order.id) → order
 */
export function buildShopifyOrderLookupMap(shopifyOrders: any[]): Map<string, any> {
  const shopifyMap = new Map<string, any>()
  shopifyOrders.forEach((order) => {
    if (order?.name) {
      shopifyMap.set(cleanOrderChannelKey(order.name), order)
    }
    if (order?.id != null) {
      shopifyMap.set(String(order.id), order)
    }
  })
  return shopifyMap
}

/** Match a Shiprocket row to a Shopify order using channel_order_id (existing rule). */
export function matchShiprocketToShopify(
  srOrder: any,
  shopifyMap: Map<string, any>,
): any | undefined {
  const cleanSrName = cleanOrderChannelKey(srOrder?.channel_order_id)
  if (!cleanSrName) return undefined
  return shopifyMap.get(cleanSrName)
}

/**
 * Normalize Shiprocket status → CRM shipment_status.
 * Copied verbatim from the existing merge implementation.
 */
export function normalizeShiprocketShipmentStatus(srStatusRaw: string): string | null {
  const srStatus = (srStatusRaw || '').toLowerCase()
  let shipment_status: string | null = null

  // Check RTO before "delivered" so "RTO DELIVERED" is not counted as Delivered
  if (srStatus.includes('rto') || srStatus.includes('returned')) {
    if (srStatus.includes('delivered') || srStatus.includes('acknowledged')) {
      shipment_status = 'rto_delivered'
    } else {
      shipment_status = 'rto'
    }
  } else if (srStatus.includes('lost') || srStatus.includes('untraceable')) {
    shipment_status = 'failure'
  } else if (srStatus.includes('undelivered') || srStatus.includes('attempt')) {
    shipment_status = 'attempted_delivery'
  } else if (srStatus.includes('fail') || srStatus.includes('error')) {
    shipment_status = 'failure'
  } else if (srStatus === 'delivered' || srStatus.startsWith('delivered')) {
    shipment_status = 'delivered'
  } else if (srStatus.includes('out for delivery')) {
    shipment_status = 'out_for_delivery'
  } else if (
    srStatus.includes('transit') ||
    srStatus.includes('reached') ||
    srStatus === 'shipped' ||
    srStatus.includes('picked up')
  ) {
    shipment_status = 'in_transit'
  } else if (srStatus.includes('pickup') || srStatus.includes('scheduled')) {
    shipment_status = 'pickup_scheduled'
  } else if (srStatus.includes('cancel')) {
    shipment_status = 'cancelled'
  }

  return shipment_status
}

export interface ShiprocketLogisticsFields {
  tracking_number: string | null
  tracking_company: string | null
  tracking_url: string | null
  shipment_status: string | null
  shipment_status_reason: string | null
  srCreatedAt: string | null
  srDeliveredAt: string | null
  srUpdatedAt: string | null
  srStatus: string
  isSrCancelled: boolean
  shiprocket_order_id: any
  shiprocket_meta: Record<string, any>
  enrichmentFulfillment: Record<string, any> | null
}

/** Extract logistics-only enrichment from a Shiprocket order row (existing merge fields). */
export function extractShiprocketLogistics(srOrder: any): ShiprocketLogisticsFields {
  const latestShipment = srOrder?.shipments?.[0]
  const tracking_number = latestShipment?.awb || srOrder?.last_mile_awb || null
  const tracking_company = latestShipment?.courier || srOrder?.last_mile_courier_name || null
  const tracking_url = srOrder?.last_mile_awb_track_url || null

  const srStatus = String(srOrder?.status || '')
  const shipment_status = normalizeShiprocketShipmentStatus(srStatus)
  const isSrCancelled = srStatus.toLowerCase().includes('cancel')

  const srCreatedAt =
    parseShiprocketDate(srOrder?.created_at) ||
    parseShiprocketDate(srOrder?.channel_created_at) ||
    null
  const srDeliveredAt = parseShiprocketDate(srOrder?.delivered_date) || null
  const srUpdatedAt = parseShiprocketDate(srOrder?.updated_at) || srCreatedAt

  const reasonCandidates = [
    srOrder?.delay_reason,
    srOrder?.pickup_exception_reason,
    latestShipment?.delay_reason,
    srOrder?.awd_etds?.courier_remarks,
    srOrder?.edd_remark,
  ].filter(Boolean)
  const shipment_status_reason = reasonCandidates.length > 0 ? reasonCandidates[0] : null

  const shiprocket_meta = {
    activities: Array.isArray(srOrder?.activities) ? srOrder.activities : [],
    status: srOrder?.status || null,
    pickup_location: srOrder?.pickup_location || null,
    shipping_method: srOrder?.shipping_method || srOrder?.ship_type || null,
    payment_status: srOrder?.payment_status || null,
    picked_up_date: srOrder?.picked_up_date || null,
    pickup_booked_date: srOrder?.pickup_booked_date || null,
    out_for_delivery_date:
      srOrder?.out_for_delivery_date || srOrder?.first_out_for_delivery_date || null,
    delivered_date: srOrder?.delivered_date || null,
    etd_date: srOrder?.etd_date || srOrder?.updated_edd_date || null,
    delay_reason: srOrder?.delay_reason || null,
    delivery_delayed: Boolean(srOrder?.delivery_delayed || srOrder?.is_delayed),
    has_calls: Boolean(srOrder?.has_calls),
    rto_reason: srOrder?.rto_reason || null,
  }

  const enrichmentFulfillment =
    shipment_status || tracking_number
      ? {
          id: latestShipment?.id || Math.floor(Math.random() * 10000),
          status: 'success',
          tracking_number,
          tracking_company,
          tracking_url,
          shipment_status: isSrCancelled ? 'cancelled' : shipment_status,
          shipment_status_reason,
          created_at: srCreatedAt,
          dispatch_date: parseShiprocketDate(srOrder?.pickup_booked_date) || srCreatedAt,
          delivery_date: srDeliveredAt,
        }
      : null

  return {
    tracking_number,
    tracking_company,
    tracking_url,
    shipment_status,
    shipment_status_reason,
    srCreatedAt,
    srDeliveredAt,
    srUpdatedAt,
    srStatus,
    isSrCancelled,
    shiprocket_order_id: srOrder?.id,
    shiprocket_meta,
    enrichmentFulfillment,
  }
}

/**
 * Statuses Phase 4 is allowed to sync (open + recently delivered).
 * Uses the same normalized labels + raw Shiprocket status text.
 */
export function isShiprocketStatusInSyncScope(
  srOrder: any,
  recentDeliveredDays = 7,
): boolean {
  const raw = String(srOrder?.status || '').toLowerCase()
  const normalized = normalizeShiprocketShipmentStatus(raw)

  if (raw.includes('cancel') || normalized === 'cancelled') return false

  const deliveredLike =
    normalized === 'delivered' ||
    normalized === 'rto_delivered' ||
    raw.includes('delivered')

  if (deliveredLike) {
    const deliveredAt =
      parseShiprocketDate(srOrder?.delivered_date) ||
      parseShiprocketDate(srOrder?.updated_at) ||
      null
    if (!deliveredAt) return true // unknown delivery time — keep in scope briefly
    const ageMs = Date.now() - new Date(deliveredAt).getTime()
    return ageMs <= recentDeliveredDays * 24 * 60 * 60 * 1000
  }

  // Open / in-progress family (Pending, Confirmed, Shipped, In Transit, OFD, pickup, NDR, RTO open…)
  return true
}
