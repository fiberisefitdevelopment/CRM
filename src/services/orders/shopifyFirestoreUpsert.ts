/**
 * Phase 3 — Shopify → Firestore upsert (merge only).
 *
 * Writes Shopify-owned fields into `orders/{shopifyOrderId}` with merge:true.
 * Never overwrites logistics fields managed by Shiprocket / Air Express.
 *
 * Gated by ORDERS_WRITE_TO_FIRESTORE=true.
 * Does not enable Firestore reads (ORDERS_READ_FROM_FIRESTORE stays off).
 */

import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

const COLLECTION = 'orders'

/** Top-level fields owned by logistics sync (Phase 4+) — never written here. */
export const LOGISTICS_FIELD_BLOCKLIST = [
  'shiprocket_meta',
  'shiprocket_order_id',
  'shiprocketOrderId',
  'airExpressOrderId',
  'airExpressShipmentId',
  'shiprocketUpdatedAt',
  'airExpressUpdatedAt',
  // Fulfillments in the CRM cache are SR-enriched (AWB, shipment_status, tracking_*).
  // Shallow Firestore merge replaces the whole array — omit to preserve logistics.
  'fulfillments',
] as const

export function isOrdersWriteToFirestoreEnabled(): boolean {
  return String(process.env.ORDERS_WRITE_TO_FIRESTORE || '').toLowerCase() === 'true'
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function stripUndefined<T>(value: T): T {
  if (value === undefined) return null as unknown as T
  if (value === null || typeof value !== 'object') return value
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

/**
 * Build a merge payload from a Shopify Admin / webhook order object.
 * Keeps the Shopify field names the UI already expects; adds source metadata.
 * Strips logistics keys so merge cannot clobber Shiprocket/Air Express data.
 */
export function buildShopifyFirestoreMergePayload(
  shopifyOrder: Record<string, any>,
  nowIso: string = new Date().toISOString(),
): Record<string, any> {
  if (!shopifyOrder?.id) {
    throw new Error('Shopify order payload missing id')
  }

  const payload: Record<string, any> = { ...shopifyOrder }

  for (const key of LOGISTICS_FIELD_BLOCKLIST) {
    delete payload[key]
  }

  // Defensive: never write logistics timestamps even if present on payload
  delete payload.shiprocketUpdatedAt
  delete payload.airExpressUpdatedAt

  const shopifyOrderId = String(shopifyOrder.id)
  payload.shopifyOrderId = shopifyOrderId
  payload.shopifyUpdatedAt =
    (typeof shopifyOrder.updated_at === 'string' && shopifyOrder.updated_at) ||
    (typeof shopifyOrder.created_at === 'string' && shopifyOrder.created_at) ||
    nowIso
  payload.updatedAt = nowIso
  payload.nameLower = String(shopifyOrder.name || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
  payload.source = 'shopify'
  payload.is_test_order =
    shopifyOrder.test === true || shopifyOrder.is_test_order === true

  return stripUndefined(payload)
}

export interface ShopifyFirestoreUpsertResult {
  skipped: boolean
  reason?: string
  docId?: string
}

/**
 * Idempotent merge upsert for a Shopify order webhook/Admin payload.
 * Doc id = String(shopifyOrder.id) — same as Phase 2 backfill for Shopify-origin orders.
 */
export async function upsertShopifyOrderToFirestore(
  shopifyOrder: Record<string, any>,
): Promise<ShopifyFirestoreUpsertResult> {
  if (!isOrdersWriteToFirestoreEnabled()) {
    return { skipped: true, reason: 'ORDERS_WRITE_TO_FIRESTORE disabled' }
  }

  if (!shopifyOrder?.id) {
    return { skipped: true, reason: 'missing_order_id' }
  }

  const docId = String(shopifyOrder.id)
  const payload = buildShopifyFirestoreMergePayload(shopifyOrder)
  const ref = getDb().collection(COLLECTION).doc(docId)

  await ref.set(payload, { merge: true })

  // Keep dashboard memory/disk in sync so reads don't wait for a full FS re-download
  try {
    const { OrderRepository } = require('@/src/repositories/orderRepository')
    OrderRepository.applyShopifyOrderToLocalSnapshot?.(payload)
  } catch {
    // non-fatal — Firestore write already succeeded
  }

  return { skipped: false, docId }
}
