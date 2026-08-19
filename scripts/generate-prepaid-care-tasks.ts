/**
 * Create care tasks for all prepaid delivered orders (intro + pack follow-ups).
 *
 * Faster than Generate UI: concurrent workers, local assignment map, quiet creates.
 *
 * Usage:
 *   npx tsx scripts/generate-prepaid-care-tasks.ts
 *   npx tsx scripts/generate-prepaid-care-tasks.ts --dry-run
 *   npx tsx scripts/generate-prepaid-care-tasks.ts --limit=500
 *   npx tsx scripts/generate-prepaid-care-tasks.ts --concurrency=8
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import { OrderRepository } from '../src/repositories/orderRepository'
import { ensureDeliveredFollowupTasks } from '../src/services/careTasks/generator'
import { invalidateCareTasksCache } from '../src/services/careTasks/queries'
import {
  CARE_EXECUTIVE_EMAILS,
  careExecutiveAssignee,
} from '../src/services/careTasks/executiveConfig'
import type { CareAssignee } from '../src/services/careTasks/types'
import { isCodOrder } from '../src/utils/orderPayment'
import { isShiprocketDeliveredStatus } from '../src/utils/orderTimeline'

const dryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : 5000
const concurrency = Math.max(
  1,
  Math.min(concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 6, 16),
)

const ASSIGNMENTS_PATH = path.join(process.cwd(), '.care-order-assignments.json')

function loadLocalAssignments(): Map<string, CareAssignee> {
  const map = new Map<string, CareAssignee>()
  try {
    if (!fs.existsSync(ASSIGNMENTS_PATH)) return map
    const raw = JSON.parse(fs.readFileSync(ASSIGNMENTS_PATH, 'utf-8'))
    const entries =
      raw && typeof raw === 'object' && raw.assignments && typeof raw.assignments === 'object'
        ? raw.assignments
        : raw
    if (!entries || typeof entries !== 'object') return map
    for (const [orderId, value] of Object.entries(entries as Record<string, any>)) {
      const email = String(value?.email || '').trim()
      if (!email) continue
      map.set(String(orderId), careExecutiveAssignee(email, String(value?.userId || ''), value?.name))
    }
  } catch (err) {
    console.warn('⚠️ Could not load local assignments:', (err as Error)?.message || err)
  }
  return map
}

function virtualAssignee(orderId: string): CareAssignee | null {
  const pool = CARE_EXECUTIVE_EMAILS
  if (!pool.length) return null
  const id = String(orderId || '')
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const email = pool[hash % pool.length]
  return careExecutiveAssignee(email)
}

async function mapPool<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, () => worker()))
  return results
}

async function main() {
  const orders = (await OrderRepository.getCachedOrders()) || []
  if (!orders.length) {
    throw new Error(
      'Orders cache is empty. Open Orders / Order Status once to warm the cache, then retry.',
    )
  }

  const prepaidDelivered = orders
    .filter(
      (o) =>
        o &&
        !o.is_test_order &&
        o.test !== true &&
        !isCodOrder(o) &&
        isShiprocketDeliveredStatus(o),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    )
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 5000)

  const assignments = loadLocalAssignments()
  console.log(`Orders in cache: ${orders.length}`)
  console.log(`Prepaid delivered to process: ${prepaidDelivered.length}`)
  console.log(`Local assignments loaded: ${assignments.size}`)
  console.log(`Concurrency: ${concurrency}${dryRun ? ' (dry-run — no writes)' : ''}`)

  if (dryRun) {
    for (const o of prepaidDelivered.slice(0, 15)) {
      console.log(`  - ${o.name || o.id} · ${o.created_at || '—'}`)
    }
    console.log('✅ Dry run complete — re-run without --dry-run to create tasks')
    return
  }

  let followupsCreated = 0
  let errors = 0
  let scanned = 0
  const started = Date.now()

  await mapPool(prepaidDelivered, concurrency, async (order, index) => {
    const orderId = String(order.id || '')
    const assignee =
      assignments.get(orderId) || virtualAssignee(orderId)
    try {
      const created = await ensureDeliveredFollowupTasks(order, assignee)
      followupsCreated += created.length
    } catch (err: any) {
      errors += 1
      console.error(
        `  ✗ ${order.name || orderId}: ${err?.message || err}`,
      )
    } finally {
      scanned += 1
      if (scanned % 25 === 0 || scanned === prepaidDelivered.length) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0)
        console.log(
          `  … ${scanned}/${prepaidDelivered.length} orders · ${followupsCreated} new tasks · ${errors} errors · ${elapsed}s`,
        )
      }
    }
    return index
  })

  invalidateCareTasksCache()

  console.log('✅ Prepaid care-task generation finished')
  console.log(`   scanned: ${scanned}`)
  console.log(`   follow-ups created: ${followupsCreated}`)
  console.log(`   errors: ${errors}`)
  console.log(`   elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main().catch((err) => {
  console.error('❌ Prepaid care-task generation failed:', err)
  process.exit(1)
})
