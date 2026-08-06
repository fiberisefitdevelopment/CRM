/**
 * Phase 5 — Shadow compare: cache vs Firestore.
 *
 * When ORDERS_SHADOW_COMPARE=true, compare cache orders to Firestore docs.
 * Always return cache data to callers — Firestore is never used as the read source.
 *
 * Ignored fields: updatedAt, shopifyUpdatedAt, shiprocketUpdatedAt, airExpressUpdatedAt
 */

import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

const COLLECTION = 'orders'

export type ShadowDiffKind =
  | 'MATCH'
  | 'MISMATCH'
  | 'MISSING_IN_FIRESTORE'
  | 'MISSING_IN_CACHE'
  | 'DUPLICATE'

export interface ShadowFieldDiff {
  field: string
  cache: unknown
  firestore: unknown
}

export interface ShadowCompareItem {
  kind: ShadowDiffKind
  docId: string
  name?: string | null
  diffs?: ShadowFieldDiff[]
}

export interface ShadowCompareReport {
  ranAt: string
  totalCacheOrders: number
  totalFirestoreOrders: number
  totalCompared: number
  matches: number
  mismatches: number
  missingInFirestore: number
  missingInCache: number
  duplicateIdsInCache: number
  duplicateIdsInFirestore: number
  sampleMismatches: ShadowCompareItem[]
  sampleMissingInFirestore: ShadowCompareItem[]
  sampleMissingInCache: ShadowCompareItem[]
  rootCauses: string[]
  readyForPhase6: boolean
}

const COMPARE_FIELDS = [
  'id',
  'name',
  'shopifyOrderId',
  'shiprocketOrderId',
  'airExpressOrderId',
  'financial_status',
  'payment_method',
  'fulfillment_status',
  'shipment_status',
  'awb',
  'tracking_number',
  'tracking_url',
  'total_price',
  'customer_name',
  'customer_phone',
] as const

export function isOrdersShadowCompareEnabled(): boolean {
  return String(process.env.ORDERS_SHADOW_COMPARE || '').toLowerCase() === 'true'
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function normStr(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  return String(v)
}

function customerName(order: any): string | null {
  const c = order?.customer
  if (!c) return null
  const name = [c.first_name || '', c.last_name || ''].join(' ').trim()
  return name || null
}

function customerPhone(order: any): string | null {
  return (
    normStr(order?.customer?.phone) ||
    normStr(order?.shipping_address?.phone) ||
    normStr(order?.phone) ||
    null
  )
}

/** Normalize comparable projection (timestamps intentionally omitted). */
export function projectOrderForShadowCompare(order: any): Record<string, string | null> {
  const ful = Array.isArray(order?.fulfillments) ? order.fulfillments[0] : null
  const shipmentStatus =
    normStr(order?.shipment_status) ||
    normStr(ful?.shipment_status) ||
    null
  const trackingNumber =
    normStr(order?.tracking_number) ||
    normStr(order?.awb) ||
    normStr(ful?.tracking_number) ||
    null
  const trackingUrl =
    normStr(order?.tracking_url) ||
    normStr(ful?.tracking_url) ||
    null
  const awb = normStr(order?.awb) || trackingNumber

  const shopifyOrderId =
    order?.shopifyOrderId != null
      ? String(order.shopifyOrderId)
      : order?.source === 'shiprocket'
        ? null
        : order?.id != null
          ? String(order.id)
          : null

  const shiprocketOrderId =
    order?.shiprocketOrderId != null
      ? String(order.shiprocketOrderId)
      : order?.shiprocket_order_id != null
        ? String(order.shiprocket_order_id)
        : null

  const airExpressOrderId =
    order?.airExpressOrderId != null ? String(order.airExpressOrderId) : null

  return {
    id: normStr(order?.id),
    name: normStr(order?.name),
    shopifyOrderId,
    shiprocketOrderId,
    airExpressOrderId,
    financial_status: normStr(order?.financial_status),
    payment_method: normStr(order?.payment_method),
    fulfillment_status: normStr(order?.fulfillment_status),
    shipment_status: shipmentStatus,
    awb,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    total_price: normStr(order?.total_price),
    customer_name: customerName(order),
    customer_phone: customerPhone(order),
  }
}

export function diffProjectedOrders(
  cacheProj: Record<string, string | null>,
  fsProj: Record<string, string | null>,
): ShadowFieldDiff[] {
  const diffs: ShadowFieldDiff[] = []
  for (const field of COMPARE_FIELDS) {
    const c = cacheProj[field] ?? null
    const f = fsProj[field] ?? null
    if (c !== f) {
      diffs.push({ field, cache: c, firestore: f })
    }
  }
  return diffs
}

function resolveCacheDocId(order: any): string {
  if (order?.source === 'shiprocket') {
    return String(order.shiprocket_order_id ?? order.shiprocketOrderId ?? order.id)
  }
  return String(order.id)
}

let lastFullCompareAt = 0
const FULL_COMPARE_COOLDOWN_MS = 5 * 60 * 1000
let fullCompareInFlight: Promise<ShadowCompareReport> | null = null

/** Non-blocking: at most one full compare every 5 minutes while flag is on. */
export function scheduleThrottledFullShadowCompare(cacheOrders: any[]): void {
  if (!isOrdersShadowCompareEnabled()) return
  if (!cacheOrders?.length) return
  const now = Date.now()
  if (fullCompareInFlight) return
  if (now - lastFullCompareAt < FULL_COMPARE_COOLDOWN_MS) return

  fullCompareInFlight = runFullShadowCompare(cacheOrders)
    .then((report) => {
      lastFullCompareAt = Date.now()
      logShadowSummary(report)
      return report
    })
    .catch((err) => {
      console.error('⚠️ Shadow compare failed:', err?.message || err)
      throw err
    })
    .finally(() => {
      fullCompareInFlight = null
    })
}

/** Non-blocking single-doc compare (1 Firestore read). */
export function scheduleShadowCompareOne(cacheOrder: any): void {
  if (!isOrdersShadowCompareEnabled()) return
  if (!cacheOrder?.id && cacheOrder?.id !== 0) return

  void (async () => {
    try {
      const docId = resolveCacheDocId(cacheOrder)
      const snap = await getDb().collection(COLLECTION).doc(docId).get()
      if (!snap.exists) {
        console.log(
          JSON.stringify({
            shadow: 'MISSING_IN_FIRESTORE',
            docId,
            name: cacheOrder.name ?? null,
          }),
        )
        return
      }
      const diffs = diffProjectedOrders(
        projectOrderForShadowCompare(cacheOrder),
        projectOrderForShadowCompare(snap.data()),
      )
      if (diffs.length === 0) {
        // Keep quiet on MATCH for single-doc path (avoid noise)
        return
      }
      console.log(
        JSON.stringify({
          shadow: 'MISMATCH',
          docId,
          name: cacheOrder.name ?? null,
          diffs,
        }),
      )
    } catch (e: any) {
      console.error('⚠️ Shadow compare one failed:', e?.message || e)
    }
  })()
}

export async function runFullShadowCompare(
  cacheOrders: any[],
): Promise<ShadowCompareReport> {
  const ranAt = new Date().toISOString()
  const cacheById = new Map<string, any>()
  let duplicateIdsInCache = 0

  for (const order of cacheOrders) {
    const id = resolveCacheDocId(order)
    if (cacheById.has(id)) duplicateIdsInCache++
    cacheById.set(id, order)
  }

  const firestoreById = new Map<string, any>()
  let duplicateIdsInFirestore = 0
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined

  for (;;) {
    let q: FirebaseFirestore.Query = getDb()
      .collection(COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(200)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    for (const doc of snap.docs) {
      if (firestoreById.has(doc.id)) duplicateIdsInFirestore++
      firestoreById.set(doc.id, doc.data())
    }
    last = snap.docs[snap.docs.length - 1]
    if (snap.size < 200) break
  }

  let matches = 0
  let mismatches = 0
  let missingInFirestore = 0
  let missingInCache = 0
  const sampleMismatches: ShadowCompareItem[] = []
  const sampleMissingInFirestore: ShadowCompareItem[] = []
  const sampleMissingInCache: ShadowCompareItem[] = []

  for (const [docId, cacheOrder] of cacheById) {
    const fsOrder = firestoreById.get(docId)
    if (!fsOrder) {
      missingInFirestore++
      if (sampleMissingInFirestore.length < 15) {
        sampleMissingInFirestore.push({
          kind: 'MISSING_IN_FIRESTORE',
          docId,
          name: cacheOrder?.name ?? null,
        })
      }
      continue
    }

    const diffs = diffProjectedOrders(
      projectOrderForShadowCompare(cacheOrder),
      projectOrderForShadowCompare(fsOrder),
    )
    if (diffs.length === 0) {
      matches++
    } else {
      mismatches++
      if (sampleMismatches.length < 25) {
        sampleMismatches.push({
          kind: 'MISMATCH',
          docId,
          name: cacheOrder?.name ?? null,
          diffs,
        })
      }
    }
  }

  for (const [docId, fsOrder] of firestoreById) {
    if (cacheById.has(docId)) continue
    missingInCache++
    if (sampleMissingInCache.length < 15) {
      sampleMissingInCache.push({
        kind: 'MISSING_IN_CACHE',
        docId,
        name: fsOrder?.name ?? null,
      })
    }
  }

  const rootCauses = inferRootCauses(sampleMismatches, sampleMissingInFirestore, sampleMissingInCache)
  const readyForPhase6 =
    mismatches === 0 &&
    missingInFirestore === 0 &&
    duplicateIdsInCache === 0 &&
    duplicateIdsInFirestore === 0

  return {
    ranAt,
    totalCacheOrders: cacheOrders.length,
    totalFirestoreOrders: firestoreById.size,
    totalCompared: cacheById.size,
    matches,
    mismatches,
    missingInFirestore,
    missingInCache,
    duplicateIdsInCache,
    duplicateIdsInFirestore,
    sampleMismatches,
    sampleMissingInFirestore,
    sampleMissingInCache,
    rootCauses,
    readyForPhase6,
  }
}

function inferRootCauses(
  mismatches: ShadowCompareItem[],
  missingFs: ShadowCompareItem[],
  missingCache: ShadowCompareItem[],
): string[] {
  const causes: string[] = []
  if (missingFs.length) {
    causes.push(
      'MISSING_IN_FIRESTORE: cache has orders not present in Firestore (stale backfill, SR-only not written, or post-backfill cache growth). Re-run backfill or enable write sync.',
    )
  }
  if (missingCache.length) {
    causes.push(
      'MISSING_IN_CACHE: Firestore has docs not in current cache (webhook/logistics wrote ahead of last cache refresh, or cache TTL/hydration gap). Refresh orders cache and re-compare.',
    )
  }

  const fieldHits = new Map<string, number>()
  for (const item of mismatches) {
    for (const d of item.diffs || []) {
      fieldHits.set(d.field, (fieldHits.get(d.field) || 0) + 1)
    }
  }
  const topFields = [...fieldHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  for (const [field, count] of topFields) {
    if (field === 'shipment_status' || field === 'awb' || field === 'tracking_number' || field === 'tracking_url') {
      causes.push(
        `MISMATCH ${field} (n=${count}): logistics fields diverge — Phase 4 sync may have updated Firestore while cache still has older merge, or vice versa. Refresh cache and/or re-run logistics sync.`,
      )
    } else if (field === 'payment_method') {
      causes.push(
        `MISMATCH payment_method (n=${count}): cache merge stamps Shiprocket payment_method; Phase 4 intentionally does not write payment_method to Firestore. Expected until a dedicated payment sync or Phase 6 projection fills it from cache rules.`,
      )
    } else if (field === 'shopifyOrderId' || field === 'shiprocketOrderId' || field === 'airExpressOrderId') {
      causes.push(
        `MISMATCH ${field} (n=${count}): source id metadata missing/differing — backfill metadata vs live cache enrichment gap.`,
      )
    } else if (field === 'customer_phone' || field === 'customer_name') {
      causes.push(
        `MISMATCH ${field} (n=${count}): customer projection differs (masked SR phones, webhook partial payloads, or address vs customer.phone).`,
      )
    } else {
      causes.push(`MISMATCH ${field} (n=${count}): review sample diffs in the report.`)
    }
  }

  if (!causes.length) {
    causes.push('No material differences detected on compared fields.')
  }
  return causes
}

function logShadowSummary(report: ShadowCompareReport) {
  console.log(
    JSON.stringify({
      shadow: 'SUMMARY',
      totalCompared: report.totalCompared,
      matches: report.matches,
      mismatches: report.mismatches,
      missingInFirestore: report.missingInFirestore,
      missingInCache: report.missingInCache,
      duplicateIdsInCache: report.duplicateIdsInCache,
      readyForPhase6: report.readyForPhase6,
    }),
  )
}
