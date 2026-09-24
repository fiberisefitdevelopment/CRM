import type { ShipwayMatchIndex } from '@/src/services/orders/shipwayOrderMatch'
import { crmOrderMatchesShipway } from '@/src/services/orders/shipwayOrderMatch'

/** True when order doc has been linked to Shipway logistics. */
export function isShipwayOrder(order: any): boolean {
  if (!order) return false
  if (order.logistics === 'shipway') return true
  const id = order.shipwayOrderId ?? order.shipway_order_id
  if (id != null && String(id).trim() !== '') return true
  const company = String(order.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  return company.includes('shipway')
}

/** Parent row, live clone, or any sibling clone may carry the Shipway link. */
export function orderTrailUsesShipway(
  order: any,
  live?: any,
  relatedClones?: any[],
  index?: ShipwayMatchIndex | null,
): boolean {
  if (isShipwayOrder(live) || isShipwayOrder(order)) return true
  if (relatedClones?.some(isShipwayOrder)) return true
  if (index?.keys.size) {
    if (crmOrderMatchesShipway(order, index)) return true
    if (live && crmOrderMatchesShipway(live, index)) return true
    if (relatedClones?.some((c) => crmOrderMatchesShipway(c, index))) return true
  }
  return false
}

export function shipwayOrderId(order: any): string | null {
  if (!isShipwayOrder(order)) return null
  const id = order.shipwayOrderId ?? order.shipway_order_id
  if (id != null && String(id).trim() !== '') return String(id).trim()
  const nameKey = String(order?.name || '').replace(/^#/, '').trim()
  return nameKey || null
}
