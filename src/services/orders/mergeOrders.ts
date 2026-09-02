/**
 * Merge Shopify (or other) order payloads into an existing CRM order
 * without clobbering Shiprocket / Air Express logistics.
 */

import { LOGISTICS_FIELD_BLOCKLIST } from '@/src/services/orders/shopifyFirestoreUpsert'
import { isCodOrder } from '@/src/utils/orderPayment'

const LOGISTICS_KEYS = new Set<string>(LOGISTICS_FIELD_BLOCKLIST)

/** Overlay fields that must not be wiped by a Shopify-only payload. */
const PRESERVE_IF_MISSING = [
  'payment_method',
  'is_test_order',
  'care_tag',
  'care_executive',
  'note',
  'source',
  'shiprocket_order_id',
  'airExpressOrderId',
] as const

export function mergeShopifyOrderIntoExisting(existing: any | null | undefined, incoming: any): any {
  if (!incoming?.id) return existing || incoming
  if (!existing) {
    const fresh = { ...incoming, source: incoming.source || 'shopify' }
    if (!fresh.payment_method && isCodOrder(fresh)) fresh.payment_method = 'cod'
    return fresh
  }

  const merged = { ...existing, ...incoming }

  for (const key of LOGISTICS_KEYS) {
    if (existing[key] != null) merged[key] = existing[key]
  }

  for (const key of PRESERVE_IF_MISSING) {
    if ((incoming[key] == null || incoming[key] === '') && existing[key] != null) {
      merged[key] = existing[key]
    }
  }

  // Shopify list/webhook often has empty fulfillments — keep live AWB / status
  if (Array.isArray(existing.fulfillments) && existing.fulfillments.length > 0) {
    const incomingHasAwb = Boolean(incoming.fulfillments?.[0]?.tracking_number)
    if (!incomingHasAwb) {
      merged.fulfillments = existing.fulfillments
      if (existing.fulfillment_status) merged.fulfillment_status = existing.fulfillment_status
    }
  }

  if (existing.fulfillment_status === 'fulfilled' && !incoming.fulfillment_status) {
    merged.fulfillment_status = 'fulfilled'
  }

  if (existing.payment_method) {
    merged.payment_method = existing.payment_method
  } else if (!merged.payment_method && isCodOrder(merged)) {
    merged.payment_method = 'cod'
  }

  merged.source = existing.source || incoming.source || 'shopify'
  return merged
}

/** Union by id. Incoming is merged onto matching base rows; unmatched incoming rows are added. */
export function mergeOrderLists(base: any[] | null | undefined, incoming: any[] | null | undefined): any[] {
  const map = new Map<string, any>()
  for (const o of base || []) {
    if (o?.id == null) continue
    map.set(String(o.id), o)
  }
  for (const o of incoming || []) {
    if (o?.id == null) continue
    const id = String(o.id)
    map.set(id, mergeShopifyOrderIntoExisting(map.get(id) || null, o))
  }
  return [...map.values()].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA
  })
}
