/**
 * One-off Phase 3 verification (not part of app runtime).
 * Run: ORDERS_WRITE_TO_FIRESTORE=true npx tsx scripts/verify-shopify-firestore-upsert.ts
 */
import dotenv from 'dotenv'
import path from 'path'
import admin from 'firebase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env') })
process.env.ORDERS_WRITE_TO_FIRESTORE = 'true'
process.env.ORDERS_READ_FROM_FIRESTORE = 'false'

import {
  upsertShopifyOrderToFirestore,
  buildShopifyFirestoreMergePayload,
  LOGISTICS_FIELD_BLOCKLIST,
} from '../src/services/orders/shopifyFirestoreUpsert'
import { getFirebaseAdmin } from '../src/firebase/firebase.config'

async function main() {
  const db = admin.firestore(getFirebaseAdmin())

  const snap = await db.collection('orders').where('source', '==', 'shopify').limit(5).get()
  let doc = snap.docs.find((d) => d.data().shiprocket_meta && d.data().fulfillments?.length)
  if (!doc) {
    const all = await db.collection('orders').limit(50).get()
    doc = all.docs.find((d) => d.data().shopifyOrderId && d.data().shiprocket_meta)
  }
  if (!doc) throw new Error('No suitable order found for logistics preservation test')

  const before = doc.data()
  const docId = doc.id
  console.log('TEST doc', docId, before.name)

  const beforeLogistics = {
    shiprocket_meta: before.shiprocket_meta,
    shiprocket_order_id: before.shiprocket_order_id,
    shiprocketOrderId: before.shiprocketOrderId,
    airExpressOrderId: before.airExpressOrderId,
    shiprocketUpdatedAt: before.shiprocketUpdatedAt,
    airExpressUpdatedAt: before.airExpressUpdatedAt,
    fulfillments: before.fulfillments,
  }

  const shopifyPayload = {
    ...before,
    note: `phase3-test-${Date.now()}`,
    financial_status: before.financial_status || 'paid',
    updated_at: new Date().toISOString(),
    shiprocket_meta: { status: 'SHOULD_NOT_OVERWRITE' },
    fulfillments: [{ tracking_number: 'FAKE', shipment_status: 'fake' }],
    shiprocketOrderId: 'SHOULD_NOT_OVERWRITE',
    airExpressOrderId: 'SHOULD_NOT_OVERWRITE',
  }

  const mergePayload = buildShopifyFirestoreMergePayload(shopifyPayload)
  for (const k of LOGISTICS_FIELD_BLOCKLIST) {
    if (k in mergePayload) throw new Error(`blocklist field leaked into payload: ${k}`)
  }
  console.log('OK blocklist omitted from merge payload')

  process.env.ORDERS_WRITE_TO_FIRESTORE = 'false'
  const skipped = await upsertShopifyOrderToFirestore(shopifyPayload)
  if (!skipped.skipped) throw new Error('expected skip when flag false')
  console.log('OK flag-off skips write')

  process.env.ORDERS_WRITE_TO_FIRESTORE = 'true'
  const r1 = await upsertShopifyOrderToFirestore(shopifyPayload)
  const r2 = await upsertShopifyOrderToFirestore(shopifyPayload)
  if (r1.docId !== docId || r2.docId !== docId) throw new Error('doc id mismatch')
  console.log('OK idempotent upsert same docId', r1.docId)

  const after = (await db.collection('orders').doc(docId).get()).data()!
  if (after.note !== shopifyPayload.note) throw new Error('note not updated')
  if (!after.shopifyUpdatedAt || !after.updatedAt) throw new Error('timestamps missing')
  console.log('OK shopify fields updated')

  const checks: Array<[string, unknown, unknown]> = [
    ['shiprocket_meta', beforeLogistics.shiprocket_meta, after.shiprocket_meta],
    ['shiprocket_order_id', beforeLogistics.shiprocket_order_id, after.shiprocket_order_id],
    ['shiprocketOrderId', beforeLogistics.shiprocketOrderId, after.shiprocketOrderId],
    ['airExpressOrderId', beforeLogistics.airExpressOrderId, after.airExpressOrderId],
    ['shiprocketUpdatedAt', beforeLogistics.shiprocketUpdatedAt, after.shiprocketUpdatedAt],
    ['airExpressUpdatedAt', beforeLogistics.airExpressUpdatedAt, after.airExpressUpdatedAt],
    ['fulfillments', beforeLogistics.fulfillments, after.fulfillments],
  ]
  for (const [name, b, a] of checks) {
    if (JSON.stringify(b) !== JSON.stringify(a)) throw new Error(`logistics field changed: ${name}`)
  }
  console.log('OK logistics fields preserved')

  console.log(
    JSON.stringify(
      {
        pass: true,
        docId,
        name: before.name,
        before: {
          note: before.note ?? null,
          awb: before.fulfillments?.[0]?.tracking_number ?? null,
          shipment_status: before.fulfillments?.[0]?.shipment_status ?? null,
          shiprocketOrderId: before.shiprocketOrderId ?? before.shiprocket_order_id ?? null,
        },
        after: {
          note: after.note,
          awb: after.fulfillments?.[0]?.tracking_number ?? null,
          shipment_status: after.fulfillments?.[0]?.shipment_status ?? null,
          shiprocketOrderId: after.shiprocketOrderId ?? after.shiprocket_order_id ?? null,
          shopifyUpdatedAt: after.shopifyUpdatedAt,
          updatedAt: after.updatedAt,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
