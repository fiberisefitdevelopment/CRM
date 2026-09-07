import { OrderRepository } from '@/src/repositories/orderRepository'
import { triggerLiveShopifyPull } from '@/src/services/orders/liveOrderSync'

/**
 * Load orders for analytics routes in-process.
 * Never HTTP-fetch /api/shopify/orders — that hairpins through the public
 * hostname on the VPS and throws undici "fetch failed".
 */
export async function loadOrdersForAnalytics(opts: {
  startDate?: string | null
  endDate?: string | null
  datePreset?: string | null
  includeTest?: boolean
  refresh?: boolean
}): Promise<{ orders: any[]; cacheEmpty: boolean }> {
  triggerLiveShopifyPull(50)

  if (opts.refresh) {
    try {
      OrderRepository.expireFirestoreOrdersSnapshot()
    } catch {
      // still serve whatever snapshot we have
    }
  }

  let cached: any[] | null = null
  try {
    cached = await OrderRepository.getCachedOrders()
  } catch (err) {
    console.error('analytics: failed to read orders snapshot', err)
    return { orders: [], cacheEmpty: true }
  }

  if (!cached || cached.length === 0) {
    return { orders: [], cacheEmpty: true }
  }

  const orders = await OrderRepository.getCachedOrdersFiltered(
    {
      tab: 'all',
      includeTest: opts.includeTest === true,
      startDate: opts.startDate || undefined,
      endDate: opts.endDate || undefined,
      datePreset: opts.datePreset || undefined,
    },
    cached,
  )

  return { orders, cacheEmpty: false }
}

