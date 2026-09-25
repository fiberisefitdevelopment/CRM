/**
 * Export RTO initiated by pincode CSV (Google Sheets / Excel).
 *
 * Usage:
 *   npx tsx scripts/export-rto-pincode-sheet.ts
 *   npx tsx scripts/export-rto-pincode-sheet.ts --start=2026-02-24 --end=2026-03-25
 */

import fs from 'fs'
import path from 'path'
import {
  buildRtoByPincodeReport,
  rtoByPincodeReportToCsv,
} from '../src/services/analytics/rtoByPincode'
import { isCreatedInDateRange } from '../src/utils/orderTimeline'

const CACHE_PATH = path.join(process.cwd(), '.orders-cache.json')
const OUT_DIR = path.join(process.cwd(), 'exports')

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}

function localTodayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDaysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

async function main() {
  const startDate = arg('start') || localDaysAgoKey(29)
  const endDate = arg('end') || localTodayKey()

  const all = loadOrdersFromDisk()
  const orders = all.filter((o) => isCreatedInDateRange(o, startDate, endDate))

  const report = buildRtoByPincodeReport(orders)
  report.summary.dateStart = startDate
  report.summary.dateEnd = endDate

  const csv = rtoByPincodeReportToCsv(report)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const filename = `rto_initiated_by_pincode_${startDate}_to_${endDate}.csv`
  const outPath = path.join(OUT_DIR, filename)
  fs.writeFileSync(outPath, csv, 'utf-8')

  console.log(`✅ Wrote ${outPath}`)
  console.log(
    `   RTO initiated: ${report.summary.totalRtoInitiated} · Pincodes: ${report.summary.uniquePincodesWithRto}`,
  )
  console.log('\nGoogle Sheets: drive.google.com → New → Google Sheets → File → Import → Upload → select this CSV')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
