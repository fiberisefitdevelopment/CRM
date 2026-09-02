/**
 * Pull the newest Shopify orders and merge them into the in-memory snapshot
 * so Order Status / Orders / notifications see new orders within seconds
 * instead of waiting for the 5-minute full Shopify+Shiprocket sync.
 */

import { OrderRepository } from '@/src/repositories/orderRepository'
import { isCodOrder } from '@/src/utils/orderPayment'

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

const MIN_INTERVAL_MS = 3_000
const DEFAULT_LIMIT = 50

let inflight: Promise<any[]> | null = null
let lastPullAt = 0

function stampCod(order: any) {
  if (order && !order.payment_method && isCodOrder(order)) {
    order.payment_method = 'cod'
  }
  if (order && !order.source) order.source = 'shopify'
  return order
}

export async function fetchRecentShopifyOrders(limit = DEFAULT_LIMIT): Promise<any[]> {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) return []

  const fetchLimit = Math.min(Math.max(1, limit), 250)
  const url =
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json` +
    `?limit=${fetchLimit}&status=any&order=created_at%20desc`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    cache: 'no-store',
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Shopify live fetch failed: ${res.status} ${res.statusText}. ${text}`.slice(0, 300))
  }

  let data: any = {}
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new Error('Shopify live fetch returned invalid JSON')
  }

  const orders = Array.isArray(data.orders) ? data.orders : []
  return orders.map(stampCod)
}

/**
 * Single-flight live pull. Merges newest Shopify orders into both cache snapshots.
 * Safe to call on every list/latest request — coalesced + 3s throttle.
 */
export async function pullLiveShopifyOrdersIntoSnapshot(limit = DEFAULT_LIMIT): Promise<any[]> {
  if (inflight) return inflight

  const now = Date.now()
  if (now - lastPullAt < MIN_INTERVAL_MS) {
    return (await OrderRepository.getCachedOrders()) || []
  }

  inflight = (async () => {
    const recent = await fetchRecentShopifyOrders(limit)
    lastPullAt = Date.now()
    if (recent.length > 0) {
      OrderRepository.mergeOrdersIntoSnapshot(recent)
      console.log(`⚡ Live-merged ${recent.length} recent Shopify orders into snapshot`)
    }
    return (await OrderRepository.getCachedOrders()) || recent
  })()
    .catch((err) => {
      console.warn('⚠️ Live Shopify pull failed:', (err as Error)?.message || err)
      lastPullAt = Date.now()
      return OrderRepository.getCachedOrders().then((o) => o || [])
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/** Kick a live pull without blocking the caller. */
export function triggerLiveShopifyPull(limit = DEFAULT_LIMIT): void {
  void pullLiveShopifyOrdersIntoSnapshot(limit)
}
