import type { AirExpressMatchIndex } from '@/src/services/orders/airExpressOrderMatch'
import { crmOrderMatchesAirExpress } from '@/src/services/orders/airExpressOrderMatch'

/** True when order doc has been linked to Aaysh / Air Express logistics sync. */
export function isAirExpressOrder(order: any): boolean {
  if (!order) return false
  const id = order.airExpressOrderId ?? order.air_express_order_id
  return id != null && String(id).trim() !== ''
}

/** Parent row, live clone, or any sibling clone may carry the Air Express link. */
export function orderTrailUsesAirExpress(
  order: any,
  live?: any,
  relatedClones?: any[],
  index?: AirExpressMatchIndex | null,
): boolean {
  if (isAirExpressOrder(live) || isAirExpressOrder(order)) return true
  if (relatedClones?.some(isAirExpressOrder)) return true
  if (index?.keys.size) {
    if (crmOrderMatchesAirExpress(order, index)) return true
    if (live && crmOrderMatchesAirExpress(live, index)) return true
    if (relatedClones?.some((c) => crmOrderMatchesAirExpress(c, index))) return true
  }
  return false
}

export function airExpressOrderId(order: any): string | null {
  if (!isAirExpressOrder(order)) return null
  return String(order.airExpressOrderId ?? order.air_express_order_id).trim()
}

/** Aaysh shipment id used by /api/external/pdf/{labels,manifests,invoices}. */
export function airExpressShipmentId(order: any): string | null {
  if (!order) return null
  const stored = order.airExpressShipmentId ?? order.air_express_shipment_id
  if (stored != null && String(stored).trim() !== '') return String(stored).trim()
  if (!isAirExpressOrder(order) && order.logistics !== 'air_express') return null
  const fromFulfillment = order.fulfillments?.[0]?.id
  if (fromFulfillment != null && String(fromFulfillment).trim() !== '' && String(fromFulfillment) !== '0') {
    return String(fromFulfillment).trim()
  }
  return null
}

/** Shopify order name / stored AE id for Aaysh API lookups. */
export function resolveAirExpressOrderIdForCrmOrder(
  order?: any,
  live?: any,
  relatedClones?: any[],
): string | null {
  const ids = [
    airExpressOrderId(live),
    airExpressOrderId(order),
    ...(relatedClones || []).map(airExpressOrderId),
  ].filter(Boolean) as string[]
  if (ids.length) return ids[0]
  const nameKey = String(order?.name || '')
    .replace(/^#/, '')
    .trim()
  return nameKey || null
}
