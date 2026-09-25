import { getZoneForState, resolveProvince } from '@/lib/india-zones'
import { isActiveRtoStatus, normalizeShipmentStatus } from '@/src/utils/orderTimeline'
import { isCodOrder } from '@/src/utils/orderPayment'

export type RtoPincodeRow = {
  rank: number
  pincode: string
  city: string
  state: string
  zone: string | null
  rtoInitiatedCount: number
  rtoDeliveredCount: number
  totalRtoCount: number
  totalOrdersInPincode: number
  rtoPct: number
  codRtoCount: number
  prepaidRtoCount: number
  rtoInitiatedValue: number
  rtoDeliveredValue: number
  rtoOrderValue: number
}

export type RtoOrderDetailRow = {
  orderName: string
  orderId: number | string
  pincode: string
  city: string
  state: string
  customerName: string
  paymentType: string
  orderValue: number
  awb: string
  courier: string
  rtoStatus: string
  rtoType: 'initiated' | 'delivered'
  createdAt: string
}

export type RtoByPincodeReport = {
  summary: {
    totalRtoInitiated: number
    totalRtoDelivered: number
    uniquePincodesWithRto: number
    totalOrdersInRange: number
    dateStart?: string
    dateEnd?: string
  }
  byPincode: RtoPincodeRow[]
  orders: RtoOrderDetailRow[]
}

function cleanPincode(zip: unknown): string {
  const digits = String(zip ?? '').replace(/\D/g, '').slice(0, 6)
  return digits.length === 6 ? digits : String(zip ?? 'Unknown').trim() || 'Unknown'
}

function isCloneOrderName(name?: string | null): boolean {
  const clean = String(name || '').replace(/^#/, '').trim().toLowerCase()
  return clean.endsWith('-c')
}

/** Open RTO initiated (excludes RTO delivered / acknowledged). */
export function isRtoInitiatedForAnalytics(order: any): boolean {
  if (!order) return false
  if (isRtoDeliveredForAnalytics(order)) return false
  if (isActiveRtoStatus(order)) return true

  const normalized = normalizeShipmentStatus(order)
  if (normalized === 'rto') return true

  const reason = String(order?.fulfillments?.[0]?.shipment_status_reason || '').toUpperCase()
  if (reason.includes('RTO') && !reason.includes('DELIVERED') && !reason.includes('ACKNOWLEDG')) {
    return true
  }

  const meta = String(order?.shiprocket_meta?.status || '').toUpperCase()
  if (meta.includes('RTO') && !meta.includes('DELIVERED') && !meta.includes('ACKNOWLEDG')) {
    return true
  }

  return false
}

/** RTO completed / returned to seller (RTO Delivered, Acknowledged, returned). */
export function isRtoDeliveredForAnalytics(order: any): boolean {
  if (!order) return false
  if (normalizeShipmentStatus(order) === 'rto_delivered') return true

  const shipStatus = String(order?.fulfillments?.[0]?.shipment_status || '').toLowerCase()
  if (shipStatus === 'rto_delivered' || shipStatus === 'returned') return true

  const meta = String(order?.shiprocket_meta?.status || '').toUpperCase()
  if (meta.includes('RTO') && (meta.includes('DELIVERED') || meta.includes('ACKNOWLEDG'))) {
    return true
  }

  const reason = String(order?.fulfillments?.[0]?.shipment_status_reason || '').toUpperCase()
  if (reason.includes('RTO') && reason.includes('DELIVERED')) return true

  return false
}

export function classifyRtoForAnalytics(order: any): 'initiated' | 'delivered' | null {
  if (isRtoDeliveredForAnalytics(order)) return 'delivered'
  if (isRtoInitiatedForAnalytics(order)) return 'initiated'
  return null
}

function customerName(order: any): string {
  const c = order.customer
  const fromCustomer = `${c?.first_name || ''} ${c?.last_name || ''}`.trim()
  if (fromCustomer) return fromCustomer
  const s = order.shipping_address
  return `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || 'Guest'
}

export function buildRtoByPincodeReport(orders: any[]): RtoByPincodeReport {
  const parents = orders.filter((o) => !isCloneOrderName(o?.name))

  type PinAgg = {
    pincode: string
    city: string
    state: string
    zone: string | null
    totalOrders: number
    rtoInitiated: number
    rtoDelivered: number
    codRto: number
    prepaidRto: number
    initiatedValue: number
    deliveredValue: number
  }

  const pinMap = new Map<string, PinAgg>()
  const detailRows: RtoOrderDetailRow[] = []

  for (const order of parents) {
    const addr = order.shipping_address || order.billing_address
    const pincode = cleanPincode(addr?.zip)
    const city = addr?.city || 'Unknown'
    const state = resolveProvince(addr?.province) || 'Unknown'
    const zone = getZoneForState(state)

    if (!pinMap.has(pincode)) {
      pinMap.set(pincode, {
        pincode,
        city,
        state,
        zone,
        totalOrders: 0,
        rtoInitiated: 0,
        rtoDelivered: 0,
        codRto: 0,
        prepaidRto: 0,
        initiatedValue: 0,
        deliveredValue: 0,
      })
    }
    const agg = pinMap.get(pincode)!
    agg.totalOrders++

    const rtoType = classifyRtoForAnalytics(order)
    if (!rtoType) continue

    const value = parseFloat(String(order.total_price ?? '').replace(/,/g, '')) || 0
    const cod = isCodOrder(order)
    if (cod) agg.codRto++
    else agg.prepaidRto++

    if (rtoType === 'delivered') {
      agg.rtoDelivered++
      agg.deliveredValue += value
    } else {
      agg.rtoInitiated++
      agg.initiatedValue += value
    }

    const f = order.fulfillments?.[0]
    detailRows.push({
      orderName: order.name || '',
      orderId: order.id,
      pincode,
      city,
      state,
      customerName: customerName(order),
      paymentType: cod ? 'COD' : 'Prepaid',
      orderValue: Math.round(value),
      awb: String(f?.tracking_number || order.awb || ''),
      courier: String(f?.tracking_company || ''),
      rtoStatus: String(
        order.shiprocket_meta?.status || f?.shipment_status_reason || f?.shipment_status || 'RTO',
      ),
      rtoType,
      createdAt: order.created_at || '',
    })
  }

  const byPincode: RtoPincodeRow[] = [...pinMap.values()]
    .filter((p) => p.rtoInitiated > 0 || p.rtoDelivered > 0)
    .sort(
      (a, b) =>
        b.rtoInitiated + b.rtoDelivered - (a.rtoInitiated + a.rtoDelivered) ||
        b.initiatedValue + b.deliveredValue - (a.initiatedValue + a.deliveredValue),
    )
    .map((p, i) => {
      const totalRto = p.rtoInitiated + p.rtoDelivered
      return {
        rank: i + 1,
        pincode: p.pincode,
        city: p.city,
        state: p.state,
        zone: p.zone,
        rtoInitiatedCount: p.rtoInitiated,
        rtoDeliveredCount: p.rtoDelivered,
        totalRtoCount: totalRto,
        totalOrdersInPincode: p.totalOrders,
        rtoPct: p.totalOrders > 0 ? Math.round((totalRto / p.totalOrders) * 1000) / 10 : 0,
        codRtoCount: p.codRto,
        prepaidRtoCount: p.prepaidRto,
        rtoInitiatedValue: Math.round(p.initiatedValue),
        rtoDeliveredValue: Math.round(p.deliveredValue),
        rtoOrderValue: Math.round(p.initiatedValue + p.deliveredValue),
      }
    })

  const initiatedOrders = detailRows.filter((o) => o.rtoType === 'initiated')
  const deliveredOrders = detailRows.filter((o) => o.rtoType === 'delivered')
  detailRows.sort((a, b) => b.orderValue - a.orderValue)

  return {
    summary: {
      totalRtoInitiated: initiatedOrders.length,
      totalRtoDelivered: deliveredOrders.length,
      uniquePincodesWithRto: byPincode.length,
      totalOrdersInRange: parents.length,
    },
    byPincode,
    orders: detailRows,
  }
}

function escapeCsv(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function appendOrderDetailCsv(lines: string[], orders: RtoOrderDetailRow[]) {
  lines.push(
    [
      'Order',
      'Order ID',
      'RTO Type',
      'Pincode',
      'City',
      'State',
      'Customer',
      'Payment',
      'Order Value (INR)',
      'AWB',
      'Courier',
      'RTO Status',
      'Created At',
    ].join(','),
  )
  for (const o of orders) {
    lines.push(
      [
        escapeCsv(o.orderName),
        o.orderId,
        o.rtoType === 'delivered' ? 'RTO Delivered' : 'RTO Initiated',
        o.pincode,
        escapeCsv(o.city),
        escapeCsv(o.state),
        escapeCsv(o.customerName),
        o.paymentType,
        o.orderValue,
        o.awb,
        escapeCsv(o.courier),
        escapeCsv(o.rtoStatus),
        o.createdAt,
      ].join(','),
    )
  }
}

export function rtoByPincodeReportToCsv(report: RtoByPincodeReport): string {
  const lines: string[] = []

  lines.push('RTO BY PINCODE — SUMMARY (ranked by total RTO: initiated + delivered)')
  lines.push(
    [
      'Rank',
      'Pincode',
      'City',
      'State',
      'Zone',
      'RTO Initiated',
      'RTO Delivered',
      'Total RTO',
      'Total Orders (Pincode)',
      'RTO %',
      'COD RTO',
      'Prepaid RTO',
      'Initiated Value (INR)',
      'Delivered Value (INR)',
      'Total RTO Value (INR)',
    ].join(','),
  )
  for (const row of report.byPincode) {
    lines.push(
      [
        row.rank,
        row.pincode,
        escapeCsv(row.city),
        escapeCsv(row.state),
        row.zone || '',
        row.rtoInitiatedCount,
        row.rtoDeliveredCount,
        row.totalRtoCount,
        row.totalOrdersInPincode,
        row.rtoPct,
        row.codRtoCount,
        row.prepaidRtoCount,
        row.rtoInitiatedValue,
        row.rtoDeliveredValue,
        row.rtoOrderValue,
      ].join(','),
    )
  }

  const initiated = report.orders.filter((o) => o.rtoType === 'initiated')
  const delivered = report.orders.filter((o) => o.rtoType === 'delivered')

  lines.push('')
  lines.push('RTO INITIATED — ORDER DETAIL')
  appendOrderDetailCsv(lines, initiated)

  lines.push('')
  lines.push('RTO DELIVERED — ORDER DETAIL')
  appendOrderDetailCsv(lines, delivered)

  return '\uFEFF' + lines.join('\n')
}
