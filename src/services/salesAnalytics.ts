import {
  buildZoneStats,
  getZoneForState,
  resolveProvince,
  ZONES,
  type IndiaZone,
} from '@/lib/india-zones'
import {
  DEFAULT_PACK_MATCHERS,
  type CareTaskConfig,
} from '@/src/services/careTasks/followupPlans'
import { resolvePackFromLineItem } from '@/src/services/careTasks/packResolver'
import { isCodOrder, getPaymentLabel } from '@/src/utils/orderPayment'

export function isOrderCancelled(order: any): boolean {
  return (
    !!order.cancelled_at ||
    order.financial_status?.toLowerCase() === 'voided' ||
    order.financial_status?.toLowerCase() === 'cancelled' ||
    order.financial_status?.toLowerCase() === 'refunded' ||
    order.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

export function getShipStatus(order: any): string {
  return (order.fulfillments?.[0]?.shipment_status || '').toLowerCase()
}

function getRemittanceStatus(order: any): 'settled' | 'pending' | 'rto' {
  if (!order.fulfillment_status) return 'pending'
  const status = getShipStatus(order)
  if (status === 'delivered') return 'settled'
  if (['failure', 'rto', 'returned'].includes(status)) return 'rto'
  return 'pending'
}

function getDisplayStatus(order: any): string {
  if (isOrderCancelled(order)) return 'cancelled'
  if (!order.fulfillment_status) return 'unfulfilled'
  const status = getShipStatus(order)
  if (status === 'delivered') return 'delivered'
  if (['failure', 'rto', 'returned'].includes(status)) return 'rto'
  if (['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status)) return 'transit'
  return 'scheduled'
}

interface SkuStats {
  sku: string
  title: string
  units: number
  revenue: number
}

interface PackStats {
  packKey: string
  label: string
  units: number
  orders: number
  revenue: number
  skus: SkuStats[]
}

function buildPackSales(orders: any[], config: CareTaskConfig): {
  products: PackStats[]
  totalUnits: number
  totalOrders: number
  totalRevenue: number
} {
  const packMap: Record<string, PackStats> = {}
  for (const m of config.packMatchers || DEFAULT_PACK_MATCHERS) {
    packMap[m.packKey] = {
      packKey: m.packKey,
      label: m.label,
      units: 0,
      orders: 0,
      revenue: 0,
      skus: [],
    }
  }

  const skuIndex: Record<string, Record<string, SkuStats>> = {}
  let totalUnits = 0
  let totalRevenue = 0
  let totalOrders = 0

  for (const order of orders) {
    if (isOrderCancelled(order)) continue

    const lineItems = Array.isArray(order.line_items) ? order.line_items : []
    let orderMatched = false

    for (const item of lineItems) {
      const pack = resolvePackFromLineItem(item, config)
      if (!pack) continue

      const qty = Number(item.quantity) || 1
      const price = parseFloat(item.price || '0')
      const discount = parseFloat(item.total_discount || '0')
      const itemRevenue = price * qty - discount
      const sku = item.sku || 'N/A'
      const title = item.title || item.name || pack.label

      const bucket = packMap[pack.packKey]
      if (!bucket) continue

      bucket.units += qty
      bucket.revenue += itemRevenue
      orderMatched = true

      if (!skuIndex[pack.packKey]) skuIndex[pack.packKey] = {}
      if (!skuIndex[pack.packKey][sku]) {
        skuIndex[pack.packKey][sku] = { sku, title, units: 0, revenue: 0 }
      }
      skuIndex[pack.packKey][sku].units += qty
      skuIndex[pack.packKey][sku].revenue += itemRevenue

      totalUnits += qty
      totalRevenue += itemRevenue
    }

    if (orderMatched) totalOrders++
  }

  const products = Object.values(packMap).map((pack) => ({
    ...pack,
    revenue: Math.round(pack.revenue),
    skus: Object.values(skuIndex[pack.packKey] || {})
      .map((s) => ({ ...s, revenue: Math.round(s.revenue) }))
      .sort((a, b) => b.units - a.units),
  }))

  return {
    products,
    totalUnits,
    totalOrders,
    totalRevenue: Math.round(totalRevenue),
  }
}

function buildZoneAnalytics(orders: any[]) {
  const zoneStats = buildZoneStats(orders)
  const totalOrders = orders.length
  const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0)

  return {
    zones: ZONES.map((zone) => {
      const stats = zoneStats[zone]
      const deliveryRate =
        stats.orderCount > 0 ? Math.round((stats.deliveredCount / stats.orderCount) * 100) : 0
      const codPct =
        stats.orderCount > 0 ? Math.round((stats.codCount / stats.orderCount) * 100) : 0
      const rtoPct =
        stats.orderCount > 0 ? Math.round((stats.rtoCount / stats.orderCount) * 100) : 0
      const revenueShare =
        totalRevenue > 0 ? Math.round((stats.revenue / totalRevenue) * 100) : 0

      const topStates = Object.entries(stats.states)
        .sort(([, a], [, b]) => b.orderCount - a.orderCount)
        .slice(0, 5)
        .map(([state, s]) => ({ state, ...s }))

      return {
        zone,
        orderCount: stats.orderCount,
        revenue: Math.round(stats.revenue),
        codCount: stats.codCount,
        deliveredCount: stats.deliveredCount,
        rtoCount: stats.rtoCount,
        deliveryRate,
        codPct,
        rtoPct,
        revenueShare,
        color: stats.color,
        topStates,
      }
    }),
    totalOrders,
    totalRevenue: Math.round(totalRevenue),
  }
}

function buildTopPincodes(orders: any[], limit = 50) {
  const customerOrderCount: Record<string, number> = {}
  orders.forEach((order) => {
    const cid = order.customer?.id?.toString()
    if (cid) customerOrderCount[cid] = (customerOrderCount[cid] || 0) + 1
  })

  const pincodeMap: Record<
    string,
    {
      pincode: string
      city: string
      state: string
      zone: IndiaZone | null
      orderCount: number
      revenue: number
      codCount: number
      deliveredCount: number
      rtoCount: number
      customerIds: Set<string>
      returningCustomerIds: Set<string>
    }
  > = {}

  orders.forEach((order) => {
    const addr = order.shipping_address
    if (!addr) return

    const pincode = (addr.zip || 'Unknown').toString().trim()
    const city = addr.city || 'Unknown'
    const state = resolveProvince(addr.province) || 'Unknown'
    const zone = getZoneForState(state)
    const price = parseFloat(order.total_price) || 0
    const shipStatus = getShipStatus(order)
    const isDelivered = shipStatus === 'delivered'
    const isRTO = ['failure', 'rto', 'returned'].includes(shipStatus)
    const cid = order.customer?.id?.toString()

    if (!pincodeMap[pincode]) {
      pincodeMap[pincode] = {
        pincode,
        city,
        state,
        zone,
        orderCount: 0,
        revenue: 0,
        codCount: 0,
        deliveredCount: 0,
        rtoCount: 0,
        customerIds: new Set(),
        returningCustomerIds: new Set(),
      }
    }

    pincodeMap[pincode].orderCount++
    pincodeMap[pincode].revenue += price
    if (isCodOrder(order)) pincodeMap[pincode].codCount++
    if (isDelivered) pincodeMap[pincode].deliveredCount++
    if (isRTO) pincodeMap[pincode].rtoCount++
    if (cid) {
      pincodeMap[pincode].customerIds.add(cid)
      if ((customerOrderCount[cid] || 0) > 1) {
        pincodeMap[pincode].returningCustomerIds.add(cid)
      }
    }
  })

  const pincodes = Object.values(pincodeMap)
    .map((p) => ({
      pincode: p.pincode,
      city: p.city,
      state: p.state,
      zone: p.zone,
      orderCount: p.orderCount,
      revenue: Math.round(p.revenue),
      aov: p.orderCount > 0 ? Math.round(p.revenue / p.orderCount) : 0,
      codPct: p.orderCount > 0 ? Math.round((p.codCount / p.orderCount) * 100) : 0,
      deliveryRate:
        p.orderCount > 0 ? Math.round((p.deliveredCount / p.orderCount) * 100) : 0,
      rtoPct: p.orderCount > 0 ? Math.round((p.rtoCount / p.orderCount) * 100) : 0,
      customerCount: p.customerIds.size,
      repeatCustomers: p.returningCustomerIds.size,
      repeatRate:
        p.customerIds.size > 0
          ? Math.round((p.returningCustomerIds.size / p.customerIds.size) * 100)
          : 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, limit)

  const uniquePincodes = Object.keys(pincodeMap).length
  const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0)

  return {
    pincodes,
    summary: {
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue),
      uniquePincodes,
    },
  }
}

function buildTransactionRow(order: any) {
  const customer = order.customer
    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
    : 'Guest Checkout'

  return {
    id: order.id,
    name: order.name,
    customer,
    createdAt: order.created_at,
    payment: getPaymentLabel(order),
    paymentType: isCodOrder(order) ? 'cod' : 'prepaid',
    status: getDisplayStatus(order),
    value: Math.round(parseFloat(order.total_price || '0')),
    currency: order.currency || 'INR',
  }
}

function buildCodLedgerRow(order: any) {
  const customer = order.customer
    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
    : 'Guest Checkout'
  const status = getShipStatus(order)
  const remittance = getRemittanceStatus(order)
  const fulfillment = order.fulfillments?.[0] || {}

  return {
    id: order.id,
    name: order.name,
    customer,
    city: order.shipping_address?.city || '',
    state: order.shipping_address?.province || '',
    pincode: order.shipping_address?.zip || '',
    amount: Math.round(parseFloat(order.total_price || '0')),
    logisticsStatus: status || 'unfulfilled',
    remittanceStatus: remittance,
    dispatchDate: order.fulfillment_status
      ? fulfillment.dispatch_date || fulfillment.created_at || null
      : null,
    deliveryDate:
      status === 'delivered'
        ? fulfillment.delivery_date || fulfillment.created_at || null
        : null,
  }
}

export function buildSalesAnalytics(orders: any[], config: CareTaskConfig) {
  const activeOrders = orders.filter((o) => !isOrderCancelled(o))
  const cancelledCount = orders.filter(isOrderCancelled).length

  let totalRevenue = 0
  let prepaidCount = 0
  let codCount = 0
  let prepaidRevenue = 0
  let codRevenue = 0
  let codTotalVolume = 0
  let codSettledCount = 0
  let codSettledRevenue = 0
  let codPendingCount = 0
  let codPendingRevenue = 0
  let codRtoCount = 0
  let codRtoRevenue = 0
  let unfulfilledCount = 0
  let scheduledCount = 0
  let inTransitCount = 0
  let deliveredCount = 0
  let rtoCount = 0

  const skuMap: Record<string, { title: string; qty: number; revenue: number }> = {}
  const dailyMap: Record<string, number> = {}

  activeOrders.forEach((o) => {
    const price = parseFloat(o.total_price) || 0
    totalRevenue += price
    const isPaid = !isCodOrder(o)
    const dateKey = new Date(o.created_at).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    })
    dailyMap[dateKey] = (dailyMap[dateKey] || 0) + price

    if (isPaid) {
      prepaidCount++
      prepaidRevenue += price
    } else {
      codCount++
      codRevenue += price
      codTotalVolume += price
      const status = getShipStatus(o)
      if (status === 'delivered') {
        codSettledCount++
        codSettledRevenue += price
      } else if (['failure', 'rto', 'returned'].includes(status)) {
        codRtoCount++
        codRtoRevenue += price
      } else {
        codPendingCount++
        codPendingRevenue += price
      }
    }

    if (!o.fulfillment_status) {
      unfulfilledCount++
    } else {
      const status = getShipStatus(o)
      if (status === 'delivered') deliveredCount++
      else if (['failure', 'rto', 'returned'].includes(status)) rtoCount++
      else if (['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status))
        inTransitCount++
      else scheduledCount++
    }

    o.line_items?.forEach((item: any) => {
      const sku = item.sku || 'N/A'
      const qty = Number(item.quantity) || 1
      const itemVal = (parseFloat(item.price) || 0) * qty
      if (!skuMap[sku]) skuMap[sku] = { title: item.title || 'Product', qty: 0, revenue: 0 }
      skuMap[sku].qty += qty
      skuMap[sku].revenue += itemVal
    })
  })

  const topProducts = Object.entries(skuMap)
    .map(([sku, d]) => ({
      sku,
      title: d.title,
      qty: d.qty,
      revenue: Math.round(d.revenue),
    }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  const totalOrdersCount = activeOrders.length
  const aov = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0
  const deliveryRate =
    totalOrdersCount > 0 ? (deliveredCount / totalOrdersCount) * 100 : 0
  const dispatchRate =
    totalOrdersCount > 0 ? ((totalOrdersCount - unfulfilledCount) / totalOrdersCount) * 100 : 0

  const dailyRevenue = Object.entries(dailyMap)
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue) }))
    .slice(-14)

  const packSales = buildPackSales(activeOrders, config)
  const zoneAnalytics = buildZoneAnalytics(activeOrders)
  const pincodeAnalytics = buildTopPincodes(activeOrders)

  const codOrders = activeOrders.filter(isCodOrder)
  const transactions = activeOrders.map(buildTransactionRow)
  const codLedger = codOrders.map(buildCodLedgerRow)

  const estimatedLogisticsCharges =
    (deliveredCount + inTransitCount + scheduledCount) * 65

  return {
    overview: {
      totalOrders: totalOrdersCount,
      cancelledCount,
      deliveredCount,
      inTransitCount,
      unfulfilledCount,
      scheduledCount,
      rtoCount,
      deliveryRate: Math.round(deliveryRate * 10) / 10,
      dispatchRate: Math.round(dispatchRate * 10) / 10,
      rtoRate:
        totalOrdersCount > 0
          ? Math.round((rtoCount / totalOrdersCount) * 1000) / 10
          : 0,
    },
    payment: {
      prepaidCount,
      prepaidRevenue: Math.round(prepaidRevenue),
      codCount,
      codRevenue: Math.round(codRevenue),
      prepaidPct:
        totalOrdersCount > 0
          ? Math.round((prepaidCount / totalOrdersCount) * 1000) / 10
          : 0,
      codPct:
        totalOrdersCount > 0
          ? Math.round((codCount / totalOrdersCount) * 1000) / 10
          : 0,
    },
    deliveryFunnel: {
      unfulfilled: unfulfilledCount,
      scheduled: scheduledCount,
      inTransit: inTransitCount,
      delivered: deliveredCount,
      rto: rtoCount,
    },
    revenue: {
      totalRevenue: Math.round(totalRevenue),
      aov: Math.round(aov),
      prepaidRevenue: Math.round(prepaidRevenue),
      codRevenue: Math.round(codRevenue),
      dailyRevenue,
    },
    cod: {
      totalVolume: Math.round(codTotalVolume),
      settledCount: codSettledCount,
      settledRevenue: Math.round(codSettledRevenue),
      pendingCount: codPendingCount,
      pendingRevenue: Math.round(codPendingRevenue),
      rtoCount: codRtoCount,
      rtoRevenue: Math.round(codRtoRevenue),
      ratio:
        totalOrdersCount > 0
          ? Math.round((codCount / totalOrdersCount) * 1000) / 10
          : 0,
    },
    codRemittance: {
      settledPct:
        codTotalVolume > 0
          ? Math.round((codSettledRevenue / codTotalVolume) * 1000) / 10
          : 0,
      pendingPct:
        codTotalVolume > 0
          ? Math.round((codPendingRevenue / codTotalVolume) * 1000) / 10
          : 0,
      rtoPct:
        codTotalVolume > 0
          ? Math.round((codRtoRevenue / codTotalVolume) * 1000) / 10
          : 0,
      grossSales: Math.round(totalRevenue),
      netSales: Math.round(totalRevenue),
      estimatedLogisticsCharges,
    },
    products: packSales.products,
    productTotals: {
      totalUnits: packSales.totalUnits,
      totalOrders: packSales.totalOrders,
      totalRevenue: packSales.totalRevenue,
    },
    topProducts,
    zones: zoneAnalytics.zones,
    zoneTotals: {
      totalOrders: zoneAnalytics.totalOrders,
      totalRevenue: zoneAnalytics.totalRevenue,
    },
    pincodes: pincodeAnalytics.pincodes,
    pincodeSummary: pincodeAnalytics.summary,
    transactions,
    codLedger,
  }
}
