/**
 * Export COD orders where cash collection is recorded (delivered + Shopify paid).
 *
 * True Shiprocket bank remittance dates are not stored in CRM; use
 * --remittance-csv=<Shiprocket COD Remittance report> when you have it.
 *
 * Usage:
 *   npx tsx scripts/export-cod-remittance-received.ts --start=2026-06-25 --end=2026-09-29
 *   npx tsx scripts/export-cod-remittance-received.ts --remittance-csv=./shiprocket_cod_remittance.csv
 */

import fs from 'fs'
import path from 'path'
import { isOrderCancelled } from '../src/services/salesAnalytics'
import { isCodOrder } from '../src/utils/orderPayment'
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
  if (!Array.isArray(orders)) throw new Error('Invalid orders cache format')
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

function shipStatus(order: any): string {
  return String(order.fulfillments?.[0]?.shipment_status || '').toLowerCase()
}

function deliveryDateIst(order: any): string {
  const f = order.fulfillments?.[0]
  if (!f || shipStatus(order) !== 'delivered') return ''
  const raw =
    f.delivery_date ||
    order.shiprocket_meta?.delivered_date ||
    f.updated_at ||
    f.created_at
  return raw ? toIstDateKey(String(raw)) : ''
}

/** Cash collected at delivery (Shopify marks COD paid after collection). */
function isCodPaymentReceived(order: any): boolean {
  if (isOrderCancelled(order)) return false
  if (!isCodOrder(order)) return false
  if (shipStatus(order) !== 'delivered') return false
  return String(order.financial_status || '').toLowerCase() === 'paid'
}

function normalizeOrderRef(value: string): string {
  return value.replace(/^#/, '').trim().toLowerCase()
}

type RemittanceRow = {
  orderRef: string
  awb: string
  remittanceDate: string
  codAmount: number
  remittanceId: string
  netAmount: number | null
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function loadShiprocketRemittanceCsv(filePath: string): Map<string, RemittanceRow> {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)
  if (!fs.existsSync(abs)) throw new Error(`Remittance CSV not found: ${abs}`)

  const text = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n')
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return new Map()

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)))

  const orderCol = idx(['order id', 'channel order', 'order_id', 'channel_order'])
  const awbCol = idx(['awb', 'awb code'])
  const dateCol = idx(['remittance date', 'remitted date', 'remit date', 'settlement date'])
  const amountCol = idx(['cod amount', 'order amount', 'collectable', 'cod_amt'])
  const netCol = idx(['remitted amount', 'net amount', 'transfer amount', 'bank amount'])
  const idCol = idx(['remittance id', 'crf', 'utr', 'reference'])

  const map = new Map<string, RemittanceRow>()
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const orderRaw = orderCol >= 0 ? cols[orderCol] || '' : ''
    const awb = awbCol >= 0 ? String(cols[awbCol] || '').trim() : ''
    const remittanceDate =
      dateCol >= 0 ? toIstDateKey(String(cols[dateCol] || '').trim()) || String(cols[dateCol] || '').trim() : ''
    const codAmount = amountCol >= 0 ? parseFloat(String(cols[amountCol] || '0').replace(/,/g, '')) : 0
    const netRaw = netCol >= 0 ? cols[netCol] : ''
    const netAmount = netRaw ? parseFloat(String(netRaw).replace(/,/g, '')) : null
    const remittanceId = idCol >= 0 ? String(cols[idCol] || '').trim() : ''

    const orderRef = normalizeOrderRef(orderRaw)
    if (!orderRef && !awb) continue

    const entry: RemittanceRow = {
      orderRef,
      awb,
      remittanceDate,
      codAmount,
      remittanceId,
      netAmount: netAmount != null && !Number.isNaN(netAmount) ? netAmount : null,
    }
    if (orderRef) map.set(`order:${orderRef}`, entry)
    if (awb) map.set(`awb:${awb}`, entry)
  }
  return map
}

function awbForOrder(order: any): string {
  return String(
    order.fulfillments?.[0]?.tracking_number ||
      order.shiprocket_meta?.awb ||
      order.shiprocket_meta?.tracking_number ||
      '',
  ).trim()
}

async function main() {
  const startDate = arg('start') || '2026-06-25'
  const endDate = arg('end') || toIstDateKey(new Date().toISOString())
  const remittanceCsv = arg('remittance-csv')
  const dateMode = (arg('date-mode') || 'order').toLowerCase() // order | delivery | remittance

  const remittanceIndex = remittanceCsv ? loadShiprocketRemittanceCsv(remittanceCsv) : null
  const bankRemittanceMode = Boolean(remittanceIndex && remittanceIndex.size > 0)

  const all = loadOrdersFromDisk()
  let matched = all.filter(isCodPaymentReceived)

  if (bankRemittanceMode) {
    matched = matched.filter((order) => {
      const nameKey = `order:${normalizeOrderRef(String(order.name || ''))}`
      const awbKey = `awb:${awbForOrder(order)}`
      const hit = remittanceIndex!.get(nameKey) || (awbKey !== 'awb:' ? remittanceIndex!.get(awbKey) : undefined)
      if (!hit) return false
      if (dateMode === 'remittance' && hit.remittanceDate) {
        const d = hit.remittanceDate.length >= 10 ? hit.remittanceDate.slice(0, 10) : hit.remittanceDate
        if (d < startDate || d > endDate) return false
      }
      return true
    })
  } else if (dateMode === 'delivery') {
    matched = matched.filter((order) => {
      const d = deliveryDateIst(order)
      return d && d >= startDate && d <= endDate
    })
  } else {
    matched = matched.filter((order) => isCreatedInDateRange(order, startDate, endDate))
  }

  matched.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  const headerNote = bankRemittanceMode
    ? 'Matched to Shiprocket COD remittance CSV; remittance_date from report.'
    : 'Proxy: delivered + financial_status=paid (cash collected). Bank remittance date not in CRM — upload Shiprocket remittance CSV with --remittance-csv.';

  const orderRows: string[] = [
    row([
      'order_date_ist',
      'order_name',
      'shopify_order_id',
      'amount_inr',
      'awb',
      'delivery_date_ist',
      'remittance_date_ist',
      'remittance_id',
      'net_remittance_inr',
      'customer_name',
      'city',
      'state',
      'pincode',
      'financial_status',
      'shipment_status',
      'data_source_note',
    ]),
  ]

  type MonthAgg = { count: number; amount: number; remitted: number }
  const byMonth: Record<string, MonthAgg> = {}

  for (const order of matched) {
    const orderDate = toIstDateKey(order.created_at)
    const month = orderDate.slice(0, 7)
    const amount = Math.round(parseFloat(order.total_price || '0') * 100) / 100
    const customer = order.customer
      ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
      : ''
    const awb = awbForOrder(order)
    const nameKey = `order:${normalizeOrderRef(String(order.name || ''))}`
    const rem =
      remittanceIndex?.get(nameKey) ||
      (awb ? remittanceIndex?.get(`awb:${awb}`) : undefined)

    const remittanceDate = rem?.remittanceDate?.slice(0, 10) || ''
    const netRemit = rem?.netAmount ?? ''

    if (!byMonth[month]) byMonth[month] = { count: 0, amount: 0, remitted: 0 }
    byMonth[month].count++
    byMonth[month].amount += amount
    if (typeof netRemit === 'number') byMonth[month].remitted += netRemit

    orderRows.push(
      row([
        orderDate,
        order.name,
        order.id,
        amount,
        awb,
        deliveryDateIst(order),
        remittanceDate,
        rem?.remittanceId || '',
        netRemit === '' ? '' : netRemit,
        customer,
        order.shipping_address?.city || '',
        order.shipping_address?.province || '',
        order.shipping_address?.zip || '',
        order.financial_status,
        shipStatus(order),
        headerNote,
      ]),
    )
  }

  const summaryRows: string[] = [
    row(['order_month_ist', 'metric', 'amount_inr', 'order_count', 'notes']),
  ]
  for (const month of Object.keys(byMonth).sort()) {
    const m = byMonth[month]
    summaryRows.push(
      row([
        month,
        'cod_payment_received',
        Math.round(m.amount),
        m.count,
        headerNote,
      ]),
    )
    if (bankRemittanceMode) {
      summaryRows.push(
        row([
          month,
          'cod_net_remittance_from_report',
          Math.round(m.remitted),
          m.count,
          'Sum of net remittance column from Shiprocket report when matched.',
        ]),
      )
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const tag = `${startDate}_to_${endDate}`
  const suffix = bankRemittanceMode ? '_bank' : '_collected'
  const ordersPath = path.join(OUT_DIR, `cod_remittance_received${suffix}_${tag}.csv`)
  const summaryPath = path.join(OUT_DIR, `cod_remittance_received${suffix}_summary_${tag}.csv`)

  fs.writeFileSync(ordersPath, orderRows.join('\n'), 'utf-8')
  fs.writeFileSync(summaryPath, summaryRows.join('\n'), 'utf-8')

  const total = matched.reduce((s, o) => s + parseFloat(o.total_price || '0'), 0)
  console.log(`✅ Orders:  ${ordersPath}`)
  console.log(`✅ Summary: ${summaryPath}`)
  console.log(`   Rows: ${matched.length} | Gross COD collected: ₹${Math.round(total).toLocaleString('en-IN')}`)
  console.log(`   Mode: ${bankRemittanceMode ? 'Shiprocket remittance CSV' : 'delivered + paid (collection proxy)'}`)
  if (!bankRemittanceMode) {
    console.log('')
    console.log(
      '   For bank remittance dates, download COD Remittance report from Shiprocket Billing and re-run with:',
    )
    console.log(`   --remittance-csv=<path> --date-mode=remittance`)
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
