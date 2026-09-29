/**
 * Finance reconciliation export: prepaid (Razorpay) + COD by order month (IST).
 *
 * Usage:
 *   npx tsx scripts/export-finance-sales-reconciliation.ts
 *   npx tsx scripts/export-finance-sales-reconciliation.ts --start=2026-07-01 --end=2026-08-31
 *   npx tsx scripts/export-finance-sales-reconciliation.ts --start=2026-06-25 --end=2026-09-30 --channel=cod
 *
 * Outputs under exports/:
 *   - finance_sales_summary_<start>_to_<end>.csv
 *   - finance_sales_orders_<start>_to_<end>.csv
 */

import fs from 'fs'
import path from 'path'
import { isOrderCancelled } from '../src/services/salesAnalytics'
import { isCodOrder, getPaymentLabel } from '../src/utils/orderPayment'
import { isCreatedInDateRange, toIstDateKey } from '../src/utils/orderTimeline'

const CACHE_PATH = path.join(process.cwd(), '.orders-cache.json')
const OUT_DIR = path.join(process.cwd(), 'exports')

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}

function loadOrdersFromDisk(): any[] {
  if (!fs.existsSync(CACHE_PATH)) {
    throw new Error('No .orders-cache.json — open Orders in the app or run a sync first.')
  }
  const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'))
  const orders = raw?.orders ?? raw?.data ?? raw
  if (!Array.isArray(orders)) {
    throw new Error('Invalid orders cache format')
  }
  return orders
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function row(cols: (string | number | null | undefined)[]): string {
  return cols.map(csvEscape).join(',')
}

function razorpayGateway(order: any): boolean {
  const g = [
    String(order.gateway || ''),
    ...(Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names.map(String) : []),
  ]
    .join(' ')
    .toLowerCase()
  return g.includes('razorpay')
}

type FinanceChannel = 'razorpay_prepaid' | 'cod' | 'other_prepaid'

function financeChannel(order: any): FinanceChannel {
  if (isCodOrder(order)) return 'cod'
  if (razorpayGateway(order)) return 'razorpay_prepaid'
  return 'other_prepaid'
}

function shipStatus(order: any): string {
  return String(order.fulfillments?.[0]?.shipment_status || '').toLowerCase()
}

function deliveryDateIst(order: any): string {
  const f = order.fulfillments?.[0]
  if (!f || shipStatus(order) !== 'delivered') return ''
  const raw = f.delivery_date || f.updated_at || f.created_at
  return raw ? toIstDateKey(String(raw)) : ''
}

function orderMonthIst(order: any): string {
  const key = toIstDateKey(order.created_at)
  return key.length >= 7 ? key.slice(0, 7) : ''
}

async function main() {
  const startDate = arg('start') || '2026-07-01'
  const endDate = arg('end') || '2026-08-31'
  const channelFilter = (arg('channel') || '').toLowerCase()
  const codOnly = channelFilter === 'cod'

  const all = loadOrdersFromDisk()
  const inRange = all.filter((o) => isCreatedInDateRange(o, startDate, endDate))
  const active = inRange
    .filter((o) => !isOrderCancelled(o))
    .filter((o) => !codOnly || financeChannel(o) === 'cod')

  type MonthAgg = Record<
    string,
    {
      razorpay_prepaid: number
      cod_gross: number
      cod_delivered: number
      other_prepaid: number
      counts: Record<FinanceChannel, number>
    }
  >

  const byMonth: MonthAgg = {}

  const orderRows: string[] = [
    row([
      'order_month_ist',
      'order_date_ist',
      'order_name',
      'shopify_order_id',
      'finance_channel',
      'payment_label',
      'amount_inr',
      'currency',
      'financial_status',
      'payment_method',
      'gateway',
      'shipment_status',
      'delivery_date_ist',
      'cancelled',
    ]),
  ]

  for (const order of active) {
    const month = orderMonthIst(order)
    if (!month) continue

    if (!byMonth[month]) {
      byMonth[month] = {
        razorpay_prepaid: 0,
        cod_gross: 0,
        cod_delivered: 0,
        other_prepaid: 0,
        counts: { razorpay_prepaid: 0, cod: 0, other_prepaid: 0 },
      }
    }

    const amount = Math.round(parseFloat(order.total_price || '0') * 100) / 100
    const channel = financeChannel(order)
    byMonth[month].counts[channel]++
    if (channel === 'razorpay_prepaid') byMonth[month].razorpay_prepaid += amount
    else if (channel === 'cod') {
      byMonth[month].cod_gross += amount
      if (shipStatus(order) === 'delivered') byMonth[month].cod_delivered += amount
    } else byMonth[month].other_prepaid += amount

    orderRows.push(
      row([
        month,
        toIstDateKey(order.created_at),
        order.name,
        order.id,
        channel,
        getPaymentLabel(order),
        amount,
        order.currency || 'INR',
        order.financial_status,
        order.payment_method || '',
        (order.payment_gateway_names || []).join('; ') || order.gateway || '',
        shipStatus(order) || (order.fulfillment_status ? 'fulfilled' : 'unfulfilled'),
        deliveryDateIst(order),
        'no',
      ]),
    )
  }

  const cancelledInRange = inRange
    .filter(isOrderCancelled)
    .filter((o) => !codOnly || financeChannel(o) === 'cod')
  for (const order of cancelledInRange) {
    const month = orderMonthIst(order)
    if (!month) continue
    orderRows.push(
      row([
        month,
        toIstDateKey(order.created_at),
        order.name,
        order.id,
        financeChannel(order),
        getPaymentLabel(order),
        Math.round(parseFloat(order.total_price || '0') * 100) / 100,
        order.currency || 'INR',
        order.financial_status,
        order.payment_method || '',
        (order.payment_gateway_names || []).join('; ') || order.gateway || '',
        shipStatus(order),
        '',
        'yes',
      ]),
    )
  }

  const summaryRows: string[] = [
    row([
      'order_month_ist',
      'metric',
      'amount_inr',
      'order_count',
      'notes',
    ]),
  ]

  const months = Object.keys(byMonth).sort()
  for (const month of months) {
    const m = byMonth[month]
    if (!codOnly) {
      summaryRows.push(
        row([
          month,
          'razorpay_prepaid_sales',
          Math.round(m.razorpay_prepaid),
          m.counts.razorpay_prepaid,
          'Order date (IST). Match Razorpay settlement report by settlement date for bank receipts.',
        ]),
      )
    }
    summaryRows.push(
      row([
        month,
        'cod_gross_sales',
        Math.round(m.cod_gross),
        m.counts.cod,
        'Order date (IST). Not comparable to Shiprocket remittance in same calendar month.',
      ]),
    )
    summaryRows.push(
      row([
        month,
        'cod_delivered_value',
        Math.round(m.cod_delivered),
        '',
        'Subset of COD where shipment_status=delivered (order month). Cash arrives later via remittance.',
      ]),
    )
    if (!codOnly) {
      summaryRows.push(
        row([
          month,
          'other_prepaid_sales',
          Math.round(m.other_prepaid),
          m.counts.other_prepaid,
          'Non-Razorpay prepaid (e.g. manual / unknown gateway).',
        ]),
      )
      summaryRows.push(
        row([
          month,
          'total_active_sales',
          Math.round(m.razorpay_prepaid + m.cod_gross + m.other_prepaid),
          m.counts.razorpay_prepaid + m.counts.cod + m.counts.other_prepaid,
          'Excludes cancelled orders.',
        ]),
      )
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const tag = `${startDate}_to_${endDate}`
  const codTag = codOnly ? '_cod' : ''
  const summaryPath = path.join(OUT_DIR, `finance_sales_summary${codTag}_${tag}.csv`)
  const ordersPath = path.join(OUT_DIR, `finance_sales_orders${codTag}_${tag}.csv`)

  fs.writeFileSync(summaryPath, summaryRows.join('\n'), 'utf-8')
  fs.writeFileSync(ordersPath, orderRows.join('\n'), 'utf-8')

  console.log(`✅ Summary: ${summaryPath}`)
  console.log(`✅ Orders:  ${ordersPath}`)
  console.log('')
  for (const month of months) {
    const m = byMonth[month]
    if (!codOnly) {
      console.log(
        `${month}  Razorpay prepaid ₹${Math.round(m.razorpay_prepaid).toLocaleString('en-IN')} (${m.counts.razorpay_prepaid} orders)`,
      )
    }
    console.log(
      `${month}  COD gross        ₹${Math.round(m.cod_gross).toLocaleString('en-IN')} (${m.counts.cod} orders)`,
    )
    if (!codOnly) {
      console.log(
        `         Other prepaid    ₹${Math.round(m.other_prepaid).toLocaleString('en-IN')} (${m.counts.other_prepaid} orders)`,
      )
    }
  }
  console.log('')
  console.log(
    'Share summary + orders CSV with finance. Bank: Razorpay = settlement date; Shiprocket COD = remittance date.',
  )
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
