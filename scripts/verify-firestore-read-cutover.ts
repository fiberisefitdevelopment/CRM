/**
 * Phase 6 — Compare cache vs Firestore read modes (same filters / pagination).
 * Does not enable production reads permanently.
 *
 * Run: npx tsx scripts/verify-firestore-read-cutover.ts
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import {
  OrderRepository,
  expireFirestoreOrdersSnapshot,
} from '../src/repositories/orderRepository'
import { projectOrderForShadowCompare } from '../src/services/orders/shadowCompare'

function setReadFlag(on: boolean) {
  process.env.ORDERS_READ_FROM_FIRESTORE = on ? 'true' : 'false'
  expireFirestoreOrdersSnapshot()
}

function stripNoise(order: any) {
  return projectOrderForShadowCompare(order)
}

function compareLists(a: any[], b: any[], label: string) {
  const diffs: any[] = []
  if (a.length !== b.length) {
    diffs.push({ label, kind: 'COUNT', cache: a.length, firestore: b.length })
  }
  const n = Math.min(a.length, b.length, 20)
  for (let i = 0; i < n; i++) {
    const ca = stripNoise(a[i])
    const cb = stripNoise(b[i])
    const fields: any[] = []
    for (const k of Object.keys(ca)) {
      if (ca[k] !== cb[k]) fields.push({ field: k, cache: ca[k], firestore: cb[k] })
    }
    if (fields.length) {
      diffs.push({ label, kind: 'ROW', index: i, id: a[i]?.id, name: a[i]?.name, fields })
    }
  }
  return diffs
}

async function main() {
  // Mode A — cache
  setReadFlag(false)
  const cacheAll = (await OrderRepository.getCachedOrders()) || []
  const cachePage1 = await OrderRepository.getCachedOrdersPaginated(1, 20, { tab: 'all' })
  const cacheDelivered = await OrderRepository.getCachedOrdersFiltered({ tab: 'delivered' })
  const cacheSearch = await OrderRepository.getCachedOrdersFiltered({
    tab: 'all',
    search: '3003',
  })
  const cacheCounts = await OrderRepository.computeTabCounts({})
  const cacheStatus = await OrderRepository.getOrderStatusPaginated(1, 20, {
    deliveryStatus: 'all',
  })

  // Mode B — Firestore
  setReadFlag(true)
  const fsAll = (await OrderRepository.getCachedOrders()) || []
  const fsPage1 = await OrderRepository.getCachedOrdersPaginated(1, 20, { tab: 'all' })
  const fsDelivered = await OrderRepository.getCachedOrdersFiltered({ tab: 'delivered' })
  const fsSearch = await OrderRepository.getCachedOrdersFiltered({ tab: 'all', search: '3003' })
  const fsCounts = await OrderRepository.computeTabCounts({})
  const fsStatus = await OrderRepository.getOrderStatusPaginated(1, 20, {
    deliveryStatus: 'all',
  })

  // Rollback — Mode A again
  setReadFlag(false)
  const rollbackAll = (await OrderRepository.getCachedOrders()) || []
  const rollbackOk = rollbackAll.length === cacheAll.length

  // Random sample of 10 ids from cache
  const sampleDiffs: any[] = []
  const step = Math.max(1, Math.floor(cacheAll.length / 10))
  for (let i = 0; i < cacheAll.length && sampleDiffs.length < 10; i += step) {
    const id = cacheAll[i].id
    setReadFlag(false)
    const c = await OrderRepository.getCachedOrderById(id)
    setReadFlag(true)
    const f = await OrderRepository.getCachedOrderById(id)
    const fields: any[] = []
    const pc = stripNoise(c || {})
    const pf = stripNoise(f || {})
    for (const k of Object.keys(pc)) {
      if (pc[k] !== pf[k]) fields.push({ field: k, cache: pc[k], firestore: pf[k] })
    }
    if (!f) sampleDiffs.push({ id, kind: 'MISSING_IN_FIRESTORE' })
    else if (fields.length) sampleDiffs.push({ id, name: c?.name, fields })
  }

  const diffs = [
    ...compareLists(cachePage1, fsPage1, 'first_page'),
    ...compareLists(cacheDelivered, fsDelivered, 'filter_delivered'),
    ...compareLists(cacheSearch, fsSearch, 'search_3003'),
    ...compareLists(cacheStatus.orders, fsStatus.orders, 'order_status_page1'),
  ]

  const countDiff =
    cacheAll.length === fsAll.length
      ? null
      : { cache: cacheAll.length, firestore: fsAll.length }

  const tabCountDiffs: any[] = []
  for (const k of Object.keys(cacheCounts) as (keyof typeof cacheCounts)[]) {
    if (cacheCounts[k] !== fsCounts[k]) {
      tabCountDiffs.push({ tab: k, cache: cacheCounts[k], firestore: fsCounts[k] })
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    responseCount: { cache: cacheAll.length, firestore: fsAll.length, equal: !countDiff },
    firstPage: {
      cache: cachePage1.length,
      firestore: fsPage1.length,
      diffs: diffs.filter((d) => d.label === 'first_page'),
    },
    filterDelivered: {
      cache: cacheDelivered.length,
      firestore: fsDelivered.length,
      diffs: diffs.filter((d) => d.label === 'filter_delivered'),
    },
    search: {
      cache: cacheSearch.length,
      firestore: fsSearch.length,
      diffs: diffs.filter((d) => d.label === 'search_3003'),
    },
    orderStatusPage: {
      cacheTotal: cacheStatus.total,
      firestoreTotal: fsStatus.total,
      diffs: diffs.filter((d) => d.label === 'order_status_page1'),
    },
    tabCounts: { cache: cacheCounts, firestore: fsCounts, diffs: tabCountDiffs },
    randomSampleDiffs: sampleDiffs,
    rollback: {
      restoredCacheReads: rollbackOk,
      rollbackCount: rollbackAll.length,
    },
    remainingDifferences: [...diffs, ...tabCountDiffs, ...sampleDiffs],
    ready: diffs.length === 0 && tabCountDiffs.length === 0 && sampleDiffs.length === 0 && rollbackOk,
  }

  const outDir = path.join(process.cwd(), 'docs', 'architecture')
  fs.writeFileSync(
    path.join(outDir, 'PHASE6_READ_CUTOVER_REPORT.json'),
    JSON.stringify(report, null, 2),
  )

  console.log(JSON.stringify({
    responseCount: report.responseCount,
    firstPageEqual: report.firstPage.diffs.length === 0,
    filterDeliveredEqual: report.filterDelivered.diffs.length === 0,
    searchEqual: report.search.diffs.length === 0,
    orderStatusEqual: report.orderStatusPage.diffs.length === 0,
    tabCountsEqual: tabCountDiffs.length === 0,
    sampleDiffs: sampleDiffs.length,
    rollbackOk,
    ready: report.ready,
    report: 'docs/architecture/PHASE6_READ_CUTOVER_REPORT.json',
  }, null, 2))

  // Leave flag false (safe default)
  setReadFlag(false)
  if (!report.ready) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
