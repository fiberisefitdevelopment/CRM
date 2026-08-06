/**
 * Phase 5 — Full shadow compare: cache vs Firestore (report only).
 *
 * Does not enable Firestore reads for the app.
 * Run: npx tsx scripts/run-shadow-compare.ts
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '.env') })
process.env.ORDERS_READ_FROM_FIRESTORE = 'false'
// Script always compares; runtime flag still gates OrderRepository hooks
process.env.ORDERS_SHADOW_COMPARE = process.env.ORDERS_SHADOW_COMPARE || 'true'

import { getCachedOrders } from '../src/services/ordersCache'
import { runFullShadowCompare } from '../src/services/orders/shadowCompare'

async function main() {
  const cacheOrders = getCachedOrders() || []
  if (!cacheOrders.length) {
    throw new Error('orders cache empty — warm via Orders UI / refresh first')
  }

  console.log(`\n🔎 Shadow compare: ${cacheOrders.length} cache orders vs Firestore…\n`)
  const report = await runFullShadowCompare(cacheOrders)

  const outDir = path.join(process.cwd(), 'docs', 'architecture')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const stamp = report.ranAt.replace(/[:.]/g, '-')
  const reportPath = path.join(outDir, `SHADOW_COMPARE_REPORT_${stamp}.json`)
  const latestPath = path.join(outDir, 'SHADOW_COMPARE_REPORT_LATEST.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2))

  console.log('—— Shadow compare statistics ——')
  console.log(`  total cache orders:     ${report.totalCacheOrders}`)
  console.log(`  total Firestore orders: ${report.totalFirestoreOrders}`)
  console.log(`  total compared:         ${report.totalCompared}`)
  console.log(`  matches:                ${report.matches}`)
  console.log(`  mismatches:             ${report.mismatches}`)
  console.log(`  missing in Firestore:   ${report.missingInFirestore}`)
  console.log(`  missing in cache:       ${report.missingInCache}`)
  console.log(`  duplicate IDs (cache):  ${report.duplicateIdsInCache}`)
  console.log(`  duplicate IDs (FS):     ${report.duplicateIdsInFirestore}`)
  console.log(`  ready for Phase 6:      ${report.readyForPhase6}`)
  console.log('\nRoot causes:')
  for (const c of report.rootCauses) console.log(`  - ${c}`)
  console.log(`\nReport: ${reportPath}`)
  console.log(`Latest: ${latestPath}\n`)

  if (!report.readyForPhase6) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
