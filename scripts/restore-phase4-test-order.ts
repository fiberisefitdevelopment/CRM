/**
 * Restore #3003 logistics after Phase 4 verify wrote TEST-AWB-PHASE4.
 */
import dotenv from 'dotenv'
import path from 'path'
import admin from 'firebase-admin'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import { getFirebaseAdmin } from '../src/firebase/firebase.config'
import { getCachedOrders } from '../src/services/ordersCache'

async function main() {
  const db = admin.firestore(getFirebaseAdmin())
  const docId = '7013246763283'
  const cached = (getCachedOrders() || []).find((o) => String(o.id) === docId)
  if (!cached) throw new Error('cache missing order')

  const payload = {
    shiprocket_order_id: cached.shiprocket_order_id ?? null,
    shiprocketOrderId: cached.shiprocket_order_id ?? cached.shiprocketOrderId ?? null,
    shiprocket_meta: cached.shiprocket_meta ?? null,
    fulfillments: cached.fulfillments ?? [],
    shipment_status: cached.fulfillments?.[0]?.shipment_status ?? null,
    tracking_number: cached.fulfillments?.[0]?.tracking_number ?? null,
    tracking_url: cached.fulfillments?.[0]?.tracking_url ?? null,
    awb: cached.fulfillments?.[0]?.tracking_number ?? null,
    shiprocketUpdatedAt: cached.shiprocketUpdatedAt ?? null,
    updatedAt: new Date().toISOString(),
  }

  await db.collection('orders').doc(docId).set(payload, { merge: true })
  console.log('Restored', docId, {
    awb: payload.awb,
    tracking_number: payload.tracking_number,
    fulfillmentsLen: Array.isArray(payload.fulfillments) ? payload.fulfillments.length : 0,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
