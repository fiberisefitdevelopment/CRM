/**
 * Phase 4 verification — logistics merge preserves Shopify-owned fields.
 * Uses cache + an existing Firestore doc (does not require live Shiprocket API).
 *
 * Run: ORDERS_WRITE_TO_FIRESTORE=true npx tsx scripts/verify-logistics-firestore-sync.ts
 */
import dotenv from 'dotenv'
import path from 'path'
import admin from 'firebase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env') })
process.env.ORDERS_WRITE_TO_FIRESTORE = 'true'
process.env.ORDERS_READ_FROM_FIRESTORE = 'false'

import { getFirebaseAdmin } from '../src/firebase/firebase.config'
import { buildShiprocketLogisticsMergePayload } from '../src/services/orders/logisticsFirestoreSync'
import { getCachedOrders } from '../src/services/ordersCache'

async function main() {
  const db = admin.firestore(getFirebaseAdmin())
  const cached = getCachedOrders() || []
  if (!cached.length) throw new Error('orders cache empty — warm cache first')

  const withLogistics = cached.find(
    (o) =>
      o?.source !== 'shiprocket' &&
      o?.shiprocket_order_id &&
      o?.shiprocket_meta &&
      (o?.fulfillments?.[0]?.tracking_number || o?.shiprocket_meta?.status),
  )
  if (!withLogistics) throw new Error('no cached Shopify order with Shiprocket logistics')

  const docId = String(withLogistics.id)
  const snap = await db.collection('orders').doc(docId).get()
  if (!snap.exists) throw new Error(`Firestore missing doc ${docId} — re-run Phase 2 backfill`)

  const before = snap.data()!
  const shopifyOwnedBefore = {
    customer: before.customer,
    shipping_address: before.shipping_address,
    line_items: before.line_items,
    total_price: before.total_price,
    financial_status: before.financial_status,
    payment_method: before.payment_method,
    note: before.note ?? null,
    shopifyUpdatedAt: before.shopifyUpdatedAt ?? null,
    email: before.email ?? null,
  }

  // Reconstruct a Shiprocket-shaped row from cache enrichment (same fields merge uses)
  const meta = withLogistics.shiprocket_meta || {}
  const ful = withLogistics.fulfillments?.[0] || {}
  const fakeSrOrder = {
    id: withLogistics.shiprocket_order_id,
    status: meta.status || 'IN TRANSIT',
    channel_order_id: String(withLogistics.name || '').replace(/^#/, ''),
    shipments: [
      {
        id: ful.id,
        awb: ful.tracking_number || 'TEST-AWB-PHASE4',
        courier: ful.tracking_company || 'TestCourier',
      },
    ],
    last_mile_awb: ful.tracking_number || 'TEST-AWB-PHASE4',
    last_mile_courier_name: ful.tracking_company || 'TestCourier',
    last_mile_awb_track_url: ful.tracking_url || 'https://example.com/track/TEST-AWB-PHASE4',
    activities: meta.activities || [],
    pickup_location: meta.pickup_location,
    shipping_method: meta.shipping_method,
    payment_status: meta.payment_status,
    picked_up_date: meta.picked_up_date,
    pickup_booked_date: meta.pickup_booked_date,
    out_for_delivery_date: meta.out_for_delivery_date,
    delivered_date: meta.delivered_date,
    etd_date: meta.etd_date,
    delay_reason: meta.delay_reason,
    delivery_delayed: meta.delivery_delayed,
    has_calls: meta.has_calls,
    rto_reason: meta.rto_reason,
    updated_at: new Date().toISOString(),
  }

  const payload = buildShiprocketLogisticsMergePayload(
    fakeSrOrder,
    withLogistics.created_at || null,
  )

  for (const k of [
    'customer',
    'shipping_address',
    'line_items',
    'total_price',
    'financial_status',
    'payment_method',
    'note',
    'shopifyUpdatedAt',
  ]) {
    if (k in payload) throw new Error(`commerce field leaked into logistics payload: ${k}`)
  }
  console.log('OK logistics payload has no Shopify-owned fields')

  await db.collection('orders').doc(docId).set(payload, { merge: true })
  await db.collection('orders').doc(docId).set(payload, { merge: true })

  const after = (await db.collection('orders').doc(docId).get()).data()!
  for (const [k, v] of Object.entries(shopifyOwnedBefore)) {
    if (JSON.stringify((after as any)[k] ?? null) !== JSON.stringify(v ?? null)) {
      throw new Error(`Shopify-owned field changed: ${k}`)
    }
  }
  console.log('OK Shopify-owned fields unchanged')

  if (String(after.shiprocketOrderId) !== String(payload.shiprocketOrderId)) {
    throw new Error('shiprocketOrderId not updated')
  }
  if (after.fulfillments?.[0]?.tracking_number !== payload.fulfillments[0].tracking_number) {
    throw new Error('AWB / tracking_number not updated')
  }
  console.log('OK logistics fields updated (idempotent)')

  console.log(
    JSON.stringify(
      {
        pass: true,
        docId,
        name: before.name,
        before: {
          awb: before.fulfillments?.[0]?.tracking_number ?? before.awb ?? null,
          shipment_status:
            before.fulfillments?.[0]?.shipment_status ?? before.shipment_status ?? null,
          financial_status: before.financial_status,
          total_price: before.total_price,
          shopifyUpdatedAt: before.shopifyUpdatedAt ?? null,
        },
        after: {
          awb: after.fulfillments?.[0]?.tracking_number ?? after.awb ?? null,
          shipment_status:
            after.fulfillments?.[0]?.shipment_status ?? after.shipment_status ?? null,
          tracking_url: after.fulfillments?.[0]?.tracking_url ?? after.tracking_url ?? null,
          shiprocketOrderId: after.shiprocketOrderId,
          shiprocketUpdatedAt: after.shiprocketUpdatedAt,
          financial_status: after.financial_status,
          total_price: after.total_price,
          shopifyUpdatedAt: after.shopifyUpdatedAt ?? null,
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
