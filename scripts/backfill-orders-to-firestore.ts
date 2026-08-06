/**
 * Phase 2 — One-time orders backfill: cache → Firestore
 *
 * Reads the exact merged order objects from the current orders cache
 * (`.orders-cache.json` / same payload `ordersCache` serves the UI).
 * Does NOT invent a new model, strip fields, or call Shopify/Shiprocket APIs.
 *
 * Doc id:
 *   - Shopify-origin → String(order.id)  [= shopifyOrderId]
 *   - Shiprocket-only (source === 'shiprocket') → String(shiprocket_order_id || id)
 *
 * Idempotent: batch.set() by doc id (re-runs overwrite, no duplicates).
 *
 * Usage:
 *   npx tsx scripts/backfill-orders-to-firestore.ts
 *   npx tsx scripts/backfill-orders-to-firestore.ts --dry-run
 *
 * Prerequisites:
 *   - Warm cache (`.orders-cache.json` present). Refresh via Orders UI if needed.
 *   - FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env
 *
 * Does NOT enable webhooks, change APIs, UI, or OrderRepository.
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import admin from 'firebase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env') })

const COLLECTION = 'orders'
const BATCH_SIZE = 50
const DISK_CACHE_PATH = path.join(process.cwd(), '.orders-cache.json')
const REPORT_DIR = path.join(process.cwd(), 'docs', 'architecture')

const dryRun = process.argv.includes('--dry-run')

/** Merged order shape currently served to the UI (verbatim from cache). */
type CachedOrder = Record<string, any>

interface SourceMeta {
  shopifyOrderId: string | null
  shiprocketOrderId: string | number | null
  airExpressOrderId: string | null
  shopifyUpdatedAt: string | null
  shiprocketUpdatedAt: string | null
  airExpressUpdatedAt: string | null
  updatedAt: string
  nameLower: string
}

interface VerificationReport {
  ranAt: string
  dryRun: boolean
  totalCacheOrders: number
  totalFirestoreOrders: number
  shopifyOrders: number
  shiprocketOnlyOrders: number
  duplicateDocIdsInCache: number
  failedWrites: number
  writeFailures: Array<{ docId: string; error: string }>
  missingRequiredFields: Record<string, number>
  sampleDocIds: { shopify: string | null; shiprocketOnly: string | null }
  notes: string[]
}

function isShiprocketOnly(order: CachedOrder): boolean {
  return order?.source === 'shiprocket'
}

function resolveDocId(order: CachedOrder): string {
  if (isShiprocketOnly(order)) {
    return String(order.shiprocket_order_id ?? order.id)
  }
  return String(order.id)
}

function buildSourceMeta(order: CachedOrder, nowIso: string): SourceMeta {
  const srOnly = isShiprocketOnly(order)
  const shopifyOrderId = srOnly ? null : String(order.id)
  const shiprocketOrderId =
    order.shiprocket_order_id != null
      ? order.shiprocket_order_id
      : srOnly
        ? order.id ?? null
        : null

  const shopifyUpdatedAt = srOnly
    ? null
    : (typeof order.updated_at === 'string' && order.updated_at) ||
      (typeof order.created_at === 'string' && order.created_at) ||
      null

  const meta = order.shiprocket_meta || {}
  const shiprocketUpdatedAt =
    shiprocketOrderId == null
      ? null
      : (typeof meta.delivered_date === 'string' && meta.delivered_date) ||
        (typeof meta.out_for_delivery_date === 'string' && meta.out_for_delivery_date) ||
        (typeof meta.picked_up_date === 'string' && meta.picked_up_date) ||
        (typeof order.updated_at === 'string' && order.updated_at) ||
        (typeof order.created_at === 'string' && order.created_at) ||
        null

  const nameLower = String(order.name || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()

  return {
    shopifyOrderId,
    shiprocketOrderId,
    airExpressOrderId: order.airExpressOrderId ?? null,
    shopifyUpdatedAt,
    shiprocketUpdatedAt,
    airExpressUpdatedAt: order.airExpressUpdatedAt ?? null,
    updatedAt: nowIso,
    nameLower,
  }
}

/** Firestore rejects `undefined`; strip recursively. Keep nulls and all other fields. */
function stripUndefined<T>(value: T): T {
  if (value === undefined) {
    return null as unknown as T
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = stripUndefined(v)
  }
  return out as T
}

function loadCacheOrders(): CachedOrder[] {
  if (!fs.existsSync(DISK_CACHE_PATH)) {
    throw new Error(
      `Missing ${DISK_CACHE_PATH}. Warm the cache first (open Orders UI or GET /api/shopify/orders?refresh=true), then re-run.`,
    )
  }
  const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf-8'))
  const orders = Array.isArray(raw?.orders) ? raw.orders : null
  if (!orders?.length) {
    throw new Error('orders-cache.json has no orders. Refresh the orders cache, then re-run.')
  }
  return orders as CachedOrder[]
}

function initFirebase(): admin.firestore.Firestore {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    )
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  }

  return admin.firestore()
}

const REQUIRED_FIELDS = [
  'id',
  'name',
  'created_at',
  'financial_status',
  'total_price',
  'customer',
  'line_items',
  'shopifyOrderId',
  'shiprocketOrderId',
  'airExpressOrderId',
  'shopifyUpdatedAt',
  'shiprocketUpdatedAt',
  'airExpressUpdatedAt',
  'updatedAt',
] as const

function countMissingFields(docs: CachedOrder[]): Record<string, number> {
  const missing: Record<string, number> = {}
  for (const field of REQUIRED_FIELDS) {
    missing[field] = 0
  }

  for (const doc of docs) {
    for (const field of REQUIRED_FIELDS) {
      const value = doc[field]
      if (field === 'shopifyOrderId') {
        // null is valid for Shiprocket-only
        if (value === undefined) missing[field]++
        continue
      }
      if (field === 'shiprocketOrderId' || field === 'airExpressOrderId') {
        if (value === undefined) missing[field]++
        continue
      }
      if (field === 'shopifyUpdatedAt' || field === 'shiprocketUpdatedAt' || field === 'airExpressUpdatedAt') {
        if (value === undefined) missing[field]++
        continue
      }
      if (field === 'customer') {
        if (!value || typeof value !== 'object') missing[field]++
        continue
      }
      if (field === 'line_items') {
        if (!Array.isArray(value)) missing[field]++
        continue
      }
      if (value === undefined || value === null || value === '') {
        missing[field]++
      }
    }
  }

  return missing
}

async function countFirestoreOrders(db: admin.firestore.Firestore): Promise<number> {
  // Prefer aggregation when available; fall back to paging.
  try {
    const agg = await db.collection(COLLECTION).count().get()
    return agg.data().count
  } catch {
    let total = 0
    let last: admin.firestore.QueryDocumentSnapshot | undefined
    for (;;) {
      let q: admin.firestore.Query = db.collection(COLLECTION).orderBy(admin.firestore.FieldPath.documentId()).limit(500)
      if (last) q = q.startAfter(last)
      const snap = await q.get()
      if (snap.empty) break
      total += snap.size
      last = snap.docs[snap.docs.length - 1]
      if (snap.size < 500) break
    }
    return total
  }
}

async function main() {
  console.log('\n📦 Phase 2 backfill: orders cache → Firestore')
  console.log(dryRun ? '   Mode: DRY RUN (no writes)\n' : '   Mode: WRITE\n')

  const cacheOrders = loadCacheOrders()
  console.log(`   Loaded ${cacheOrders.length} orders from ${path.basename(DISK_CACHE_PATH)}`)

  // Describe shape once (for operators) — do not transform orders
  const sampleShopify = cacheOrders.find((o) => !isShiprocketOnly(o))
  const sampleSr = cacheOrders.find((o) => isShiprocketOnly(o))
  console.log(
    `   Shape: Shopify-origin ~${sampleShopify ? Object.keys(sampleShopify).length : '?'} keys (full Admin object + enrichment)`,
  )
  console.log(
    `   Shape: Shiprocket-only ~${sampleSr ? Object.keys(sampleSr).length : '?'} keys (formatted custom order)`,
  )

  const nowIso = new Date().toISOString()
  const prepared: Array<{ docId: string; data: CachedOrder }> = []
  const seen = new Map<string, number>()
  let shopifyCount = 0
  let shiprocketOnlyCount = 0

  for (const order of cacheOrders) {
    const docId = resolveDocId(order)
    seen.set(docId, (seen.get(docId) || 0) + 1)

    if (isShiprocketOnly(order)) shiprocketOnlyCount++
    else shopifyCount++

    const meta = buildSourceMeta(order, nowIso)
    // Spread order first, then meta — meta fields are additive; do not strip order keys
    const data = stripUndefined({
      ...order,
      ...meta,
    })
    prepared.push({ docId, data })
  }

  const duplicateDocIdsInCache = [...seen.values()].filter((n) => n > 1).length

  const writeFailures: Array<{ docId: string; error: string }> = []
  let failedWrites = 0

  if (!dryRun) {
    const db = initFirebase()
    console.log(`   Writing ${prepared.length} docs to '${COLLECTION}' in batches of ${BATCH_SIZE}…`)

    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const slice = prepared.slice(i, i + BATCH_SIZE)
      const batch = db.batch()
      for (const { docId, data } of slice) {
        const ref = db.collection(COLLECTION).doc(docId)
        batch.set(ref, data) // full overwrite by id → idempotent
      }
      try {
        await batch.commit()
        console.log(`   ✓ batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${slice.length}`)
      } catch (err: any) {
        // Fall back to smaller sub-batches, then per-doc if needed
        console.error(`   ✗ batch failed, retrying in smaller chunks:`, err?.message || err)
        const SUB = 10
        for (let j = 0; j < slice.length; j += SUB) {
          const sub = slice.slice(j, j + SUB)
          const subBatch = db.batch()
          for (const { docId, data } of sub) {
            subBatch.set(db.collection(COLLECTION).doc(docId), data)
          }
          try {
            await subBatch.commit()
            console.log(`   ✓ sub-batch wrote ${sub.length}`)
          } catch (subErr: any) {
            for (const { docId, data } of sub) {
              try {
                await db.collection(COLLECTION).doc(docId).set(data)
              } catch (e: any) {
                failedWrites++
                writeFailures.push({ docId, error: e?.message || String(e) })
              }
            }
          }
        }
      }
    }
  } else {
    console.log(`   Dry run: would write ${prepared.length} docs (skipped)`)
  }

  let totalFirestoreOrders = 0
  if (!dryRun) {
    const db = admin.firestore()
    totalFirestoreOrders = await countFirestoreOrders(db)
  }

  const missingRequiredFields = countMissingFields(prepared.map((p) => p.data))

  const report: VerificationReport = {
    ranAt: nowIso,
    dryRun,
    totalCacheOrders: cacheOrders.length,
    totalFirestoreOrders: dryRun ? 0 : totalFirestoreOrders,
    shopifyOrders: shopifyCount,
    shiprocketOnlyOrders: shiprocketOnlyCount,
    duplicateDocIdsInCache,
    failedWrites,
    writeFailures,
    missingRequiredFields,
    sampleDocIds: {
      shopify: sampleShopify ? resolveDocId(sampleShopify) : null,
      shiprocketOnly: sampleSr ? resolveDocId(sampleSr) : null,
    },
    notes: [
      'Documents store the exact merged cache object plus additive source metadata fields.',
      'No fields were removed from the cache payload.',
      'ORDERS_WRITE_TO_FIRESTORE / webhooks were NOT enabled.',
      'APIs, UI, and OrderRepository were NOT modified.',
    ],
  }

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true })
  const reportPath = path.join(
    REPORT_DIR,
    `BACKFILL_REPORT_${nowIso.replace(/[:.]/g, '-')}${dryRun ? '_DRY' : ''}.json`,
  )
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')

  // Also write a stable latest pointer for easy reading
  const latestPath = path.join(REPORT_DIR, 'BACKFILL_REPORT_LATEST.json')
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log('\n—— Verification report ——')
  console.log(`  total cache orders:      ${report.totalCacheOrders}`)
  console.log(`  total Firestore orders:  ${report.totalFirestoreOrders}${dryRun ? ' (n/a dry-run)' : ''}`)
  console.log(`  Shopify orders:          ${report.shopifyOrders}`)
  console.log(`  Shiprocket-only orders:  ${report.shiprocketOnlyOrders}`)
  console.log(`  duplicate doc ids:       ${report.duplicateDocIdsInCache}`)
  console.log(`  failed writes:           ${report.failedWrites}`)
  console.log(`  missing required fields: ${JSON.stringify(report.missingRequiredFields)}`)
  console.log(`  report written:          ${reportPath}`)
  console.log(`  latest pointer:          ${latestPath}`)
  console.log('\n✅ Phase 2 backfill script finished. Stopped — awaiting Phase 3 approval.\n')

  if (failedWrites > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
