/** In-memory cache for Order Status list — survives route unmounts within the same session. */

/** Short TTL — only for instant paint while the same filter set revalidates. */
const TTL_MS = 20_000
const MAX_ENTRIES = 24

export interface OrderStatusPageCachePayload {
  orders: unknown[]
  summary: Record<string, unknown>
  total: number
  totalPages: number
  couriers: string[]
  channelBreakdown: Record<string, unknown>
}

interface CacheEntry extends OrderStatusPageCachePayload {
  ts: number
}

const store = new Map<string, CacheEntry>()

export function readOrderStatusPageCache(key: string): OrderStatusPageCachePayload | null {
  const entry = store.get(key)
  if (!entry || Date.now() - entry.ts > TTL_MS) {
    if (entry) store.delete(key)
    return null
  }
  const { ts: _ts, ...payload } = entry
  return payload
}

export function writeOrderStatusPageCache(key: string, payload: OrderStatusPageCachePayload): void {
  store.set(key, { ...payload, ts: Date.now() })
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) store.delete(oldest[0])
  }
}
