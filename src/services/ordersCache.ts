// Dedicated in-memory cache service for Shopify and Shiprocket orders
// to comply with Next.js App Router route file export limitations.

export let cachedOrders: any[] | null = null
export let cacheExpiresAt = 0
export const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes in-memory cache

export let activeFetchPromise: Promise<any> | null = null

export function getCachedOrders() {
  return cachedOrders
}

export function setCachedOrders(orders: any[], expiresAt: number) {
  // Always store newest-first so paginated page 1 shows the most recent orders
  cachedOrders = [...orders].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime()
    const dateB = new Date(b.created_at || 0).getTime()
    return dateB - dateA // descending
  })
  cacheExpiresAt = expiresAt
}

export function getCacheExpiresAt() {
  return cacheExpiresAt
}

export function getCachedOrderById(id: string | number) {
  return cachedOrders?.find(o => String(o.id) === String(id)) || null
}

export function removeOrderFromCache(id: string | number) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.filter(o => String(o.id) !== String(id))
  }
}

export function cancelOrderInCache(id: string | number) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.map(o => {
      if (String(o.id) === String(id)) {
        return {
          ...o,
          cancelled_at: new Date().toISOString(),
          financial_status: 'voided'
        }
      }
      return o
    })
  }
}

export function getActiveFetchPromise() {
  return activeFetchPromise
}

export function setActiveFetchPromise(p: Promise<any> | null) {
  activeFetchPromise = p
}

// ── Paginated Access ─────────────────────────────────────────────────────────

export interface OrderFilters {
  tab?: string
  search?: string
  financial?: string
  paymentType?: string
  channel?: string
  courier?: string
  pickupLocation?: string
  weightClass?: string
  rtoRisk?: string
  minPrice?: string
  maxPrice?: string
  datePreset?: string
  startDate?: string
  endDate?: string
  fulfillmentStatus?: string
  is_test_order?: boolean
}

export function getCachedOrdersCount(filters: OrderFilters = {}): number {
  return getCachedOrdersFiltered(filters).length
}

export function getCachedOrdersPaginated(page: number, perPage: number, filters: OrderFilters = {}): any[] {
  const filtered = getCachedOrdersFiltered(filters)
  const tab = filters.tab || 'all'
  // Ensure newest-first order based on relevant status date
  const sorted = [...filtered].sort((a, b) => {
    let dateStrA = a.created_at
    let dateStrB = b.created_at
    if (tab === 'rto' || tab === 'delivered' || tab === 'in_transit') {
      dateStrA = a.fulfillments?.[0]?.created_at || a.created_at
      dateStrB = b.fulfillments?.[0]?.created_at || b.created_at
    } else if (tab === 'cancelled') {
      dateStrA = a.cancelled_at || a.created_at
      dateStrB = b.cancelled_at || b.created_at
    }
    const dateA = new Date(dateStrA || 0).getTime()
    const dateB = new Date(dateStrB || 0).getTime()
    return dateB - dateA
  })
  const start = (page - 1) * perPage
  return sorted.slice(start, start + perPage)
}

// ── Tab Count Computation ────────────────────────────────────────────────────
// Mirrors the frontend tab-bucketing logic so counts can be returned server-side

function isOrderCancelled(order: any): boolean {
  return (
    !!order.cancelled_at ||
    order.financial_status?.toLowerCase() === 'voided' ||
    order.financial_status?.toLowerCase() === 'cancelled' ||
    order.financial_status?.toLowerCase() === 'refunded' ||
    order.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

export interface TabCounts {
  new: number
  ready_to_ship: number
  pickups_manifests: number
  in_transit: number
  delivered: number
  rto: number
  cancelled: number
  all: number
  test_orders: number
}

export function computeTabCounts(filters: Omit<OrderFilters, 'tab'> = {}): TabCounts {
  const counts: TabCounts = {
    new: 0,
    ready_to_ship: 0,
    pickups_manifests: 0,
    in_transit: 0,
    delivered: 0,
    rto: 0,
    cancelled: 0,
    all: 0,
    test_orders: 0,
  }

  // Count test orders directly from memory cache
  if (cachedOrders) {
    counts.test_orders = cachedOrders.filter(o => o.is_test_order === true).length
  }

  // Get list without date filters first, then apply date filters dynamically inside the loop
  const { datePreset, startDate, endDate, ...otherFilters } = filters
  const list = getCachedOrdersFiltered({ ...otherFilters, tab: 'all' })
  if (list.length === 0) return counts

  let resolvedStart = startDate || ''
  let resolvedEnd = endDate || ''

  if (datePreset && datePreset !== 'all') {
    const now = new Date()
    if (datePreset === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    } else if (datePreset === 'yesterday') {
      const start = new Date()
      start.setDate(now.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setDate(now.getDate() - 1)
      end.setHours(23, 59, 59, 999)
      resolvedStart = start.toISOString()
      resolvedEnd = end.toISOString()
    } else if (datePreset === '7days') {
      const start = new Date()
      start.setDate(now.getDate() - 7)
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    } else if (datePreset === '30days') {
      const start = new Date()
      start.setDate(now.getDate() - 30)
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    }
  }

  const startLimit = resolvedStart ? new Date(resolvedStart) : null
  const endLimit = resolvedEnd ? new Date(resolvedEnd) : null

  const checkDateInRange = (dateStr: string) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    if (startLimit && d < startLimit) return false
    if (endLimit && d > endLimit) return false
    return true
  }

  const now = Date.now()

  for (const o of list) {
    const isOrderDateInRange = checkDateInRange(o.created_at)

    if (isOrderDateInRange) {
      counts.all++
    }

    if (isOrderCancelled(o)) {
      const cancelDate = o.cancelled_at || o.created_at
      if (checkDateInRange(cancelDate)) {
        counts.cancelled++
      }
      continue
    }

    if (!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') {
      const ageInMs = now - new Date(o.created_at).getTime()
      const ageInDays = ageInMs / (1000 * 60 * 60 * 24)
      if (ageInDays <= 2) {
        if (isOrderDateInRange) {
          counts.new++
        }
      }
      continue
    }

    if (o.fulfillment_status === 'fulfilled') {
      const latest = o.fulfillments?.[0]
      const status = (latest?.shipment_status || '').toLowerCase()
      const fulfillmentDate = latest?.created_at || o.created_at

      if (['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status)) {
        if (checkDateInRange(fulfillmentDate)) {
          counts.in_transit++
        }
      } else if (status === 'delivered') {
        if (checkDateInRange(fulfillmentDate)) {
          counts.delivered++
        }
      } else if (['failure', 'rto', 'returned'].includes(status)) {
        if (checkDateInRange(fulfillmentDate)) {
          counts.rto++
        }
      } else {
        // pickup_scheduled, confirmed, label_printed, etc. → ready to ship
        if (isOrderDateInRange) {
          counts.ready_to_ship++
        }
      }
    }
  }

  return counts
}

// ── Generic Filter Logic ─────────────────────────────────────────────────────

export function getCachedOrdersFiltered(filters: OrderFilters): any[] {
  if (!cachedOrders) return []

  let list = cachedOrders

  // Filter test orders first
  const tab = filters.tab || 'all'
  if (tab === 'test_orders') {
    list = list.filter(o => o.is_test_order === true)
  } else {
    list = list.filter(o => o.is_test_order !== true)
  }

  // 1. Tab Filtering
  if (tab !== 'all' && tab !== 'test_orders') {
    const now = Date.now()
    list = list.filter((o) => {
      const isCancelled = isOrderCancelled(o)
      if (tab === 'cancelled') return isCancelled
      if (isCancelled) return false

      if (tab === 'new') {
        if (!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') {
          const ageInMs = now - new Date(o.created_at).getTime()
          const ageInDays = ageInMs / (1000 * 60 * 60 * 24)
          return ageInDays <= 2
        }
        return false
      }

      if (tab === 'ready_to_ship') {
        if (o.fulfillment_status === 'fulfilled') {
          const latest = o.fulfillments?.[0]
          const status = (latest?.shipment_status || '').toLowerCase()
          return !['in_transit', 'out_for_delivery', 'attempted_delivery', 'delivered', 'failure', 'rto', 'returned', 'cancelled'].includes(status)
        }
        return false
      }

      if (o.fulfillment_status === 'fulfilled') {
        const latest = o.fulfillments?.[0]
        const status = (latest?.shipment_status || '').toLowerCase()

        if (tab === 'in_transit') {
          return ['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status)
        }
        if (tab === 'delivered') {
          return status === 'delivered'
        }
        if (tab === 'rto') {
          return ['failure', 'rto', 'returned'].includes(status)
        }
      }

      return false
    })
  }

  // 2. Search query filtering
  if (filters.search) {
    const q = filters.search.toLowerCase().trim()
    list = list.filter((o) => {
      const orderName = o.name?.toLowerCase() || ''
      const orderId = String(o.id || '')
      const customerName = o.customer
        ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.toLowerCase()
        : ''
      const customerEmail = o.customer?.email?.toLowerCase() || ''

      return (
        orderName.includes(q) ||
        orderId.includes(q) ||
        customerName.includes(q) ||
        customerEmail.includes(q)
      )
    })
  }

  // 3. Financial Status
  if (filters.financial && filters.financial !== 'all') {
    const targetStatus = filters.financial.toLowerCase()
    list = list.filter((o) => (o.financial_status || '').toLowerCase() === targetStatus)
  }

  // 4. Payment Type
  if (filters.paymentType && filters.paymentType !== 'all') {
    list = list.filter((o) => {
      const isPaid = o.financial_status?.toLowerCase() === 'paid'
      const matchesCod = filters.paymentType === 'cod' && !isPaid
      const matchesPrepaid = filters.paymentType === 'prepaid' && isPaid
      return matchesCod || matchesPrepaid
    })
  }

  // 5. Courier Partner
  if (filters.courier && filters.courier !== 'all') {
    const targetCourier = filters.courier.toLowerCase()
    list = list.filter((o) => {
      const activeCourier = o.fulfillments?.[0]?.tracking_company?.toLowerCase() || ''
      return activeCourier.includes(targetCourier)
    })
  }

  // 6. Pickup Location
  if (filters.pickupLocation && filters.pickupLocation !== 'all') {
    if (filters.pickupLocation !== 'primary') {
      return [] // mock pickup matching only 'primary'
    }
  }

  // 7. Weight Class
  if (filters.weightClass && filters.weightClass !== 'all') {
    list = list.filter(() => {
      const weight = 0.45 // Mock dead weight (0.45 kg)
      if (filters.weightClass === 'under_05') return weight < 0.5
      if (filters.weightClass === '05_to_1') return weight >= 0.5 && weight <= 1.0
      if (filters.weightClass === '1_to_2') return weight >= 1.0 && weight <= 2.0
      if (filters.weightClass === 'above_2') return weight > 2.0
      return true
    })
  }

  // 8. RTO Risk Level
  if (filters.rtoRisk && filters.rtoRisk !== 'all') {
    const targetRisk = filters.rtoRisk.toLowerCase()
    list = list.filter((o) => {
      const price = parseFloat(o.total_price)
      const isCod = o.financial_status?.toLowerCase() === 'pending'
      let risk = 'low risk'
      if (isCod && price > 1000) {
        risk = 'high risk'
      } else if (isCod) {
        risk = 'medium risk'
      }
      return risk.includes(targetRisk)
    })
  }

  // 9. Price boundaries
  if (filters.minPrice || filters.maxPrice) {
    list = list.filter((o) => {
      const price = parseFloat(o.total_price)
      if (isNaN(price)) return false
      if (filters.minPrice && price < parseFloat(filters.minPrice)) return false
      if (filters.maxPrice && price > parseFloat(filters.maxPrice)) return false
      return true
    })
  }

  // 10. Date boundaries & Presets
  let resolvedStart = filters.startDate || ''
  let resolvedEnd = filters.endDate || ''

  if (filters.datePreset && filters.datePreset !== 'all') {
    const now = new Date()
    if (filters.datePreset === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    } else if (filters.datePreset === 'yesterday') {
      const start = new Date()
      start.setDate(now.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setDate(now.getDate() - 1)
      end.setHours(23, 59, 59, 999)
      resolvedStart = start.toISOString()
      resolvedEnd = end.toISOString()
    } else if (filters.datePreset === '7days') {
      const start = new Date()
      start.setDate(now.getDate() - 7)
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    } else if (filters.datePreset === '30days') {
      const start = new Date()
      start.setDate(now.getDate() - 30)
      start.setHours(0, 0, 0, 0)
      resolvedStart = start.toISOString()
      resolvedEnd = now.toISOString()
    }
  }

  if (resolvedStart || resolvedEnd) {
    list = list.filter((o) => {
      let relevantDateStr = o.created_at
      if (tab === 'rto') {
        relevantDateStr = o.fulfillments?.[0]?.created_at || o.created_at
      } else if (tab === 'delivered') {
        relevantDateStr = o.fulfillments?.[0]?.created_at || o.created_at
      } else if (tab === 'in_transit') {
        relevantDateStr = o.fulfillments?.[0]?.created_at || o.created_at
      } else if (tab === 'cancelled') {
        relevantDateStr = o.cancelled_at || o.created_at
      }

      const orderDate = new Date(relevantDateStr)
      if (resolvedStart) {
        const start = new Date(resolvedStart)
        if (orderDate < start) return false
      }
      if (resolvedEnd) {
        const end = new Date(resolvedEnd)
        if (orderDate > end) return false
      }
      return true
    })
  }

  // 11. Fulfillment Status Sub-status
  if (filters.fulfillmentStatus && filters.fulfillmentStatus !== 'all') {
    const targetLabel = filters.fulfillmentStatus.toLowerCase()
    list = list.filter((o) => {
      let label = 'unfulfilled'
      if (isOrderCancelled(o)) {
        label = 'cancelled'
      } else if (o.fulfillment_status === 'fulfilled') {
        const status = (o.fulfillments?.[0]?.shipment_status || '').toLowerCase()
        if (status === 'delivered') label = 'delivered'
        else if (status === 'in_transit') label = 'in transit'
        else if (status === 'out_for_delivery') label = 'out for delivery'
        else if (status === 'failure') label = 'delivery failed'
        else if (status === 'rto') label = 'rto'
        else if (status === 'attempted_delivery') label = 'attempted'
        else if (status === 'confirmed') label = 'confirmed'
        else if (['label_printed', 'label_purchased'].includes(status)) label = 'label printed'
        else if (status) label = status
        else label = 'fulfilled'
      }
      return label === targetLabel
    })
  }

  return list
}

export function addOrderToCache(order: any) {
  if (cachedOrders) {
    if (!cachedOrders.some(o => String(o.id) === String(order.id))) {
      // Prepend and re-sort to maintain newest-first invariant
      cachedOrders = [order, ...cachedOrders].sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime()
        const dateB = new Date(b.created_at || 0).getTime()
        return dateB - dateA
      })
    }
  } else {
    cachedOrders = [order]
  }
}

export function toggleTestOrderInCache(id: string | number, isTest: boolean) {
  if (cachedOrders) {
    cachedOrders = cachedOrders.map(o => {
      if (String(o.id) === String(id)) {
        return {
          ...o,
          is_test_order: isTest
        }
      }
      return o
    })
  }
}


