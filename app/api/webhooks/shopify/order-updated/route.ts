/**
 * Shopify Webhook — Order Updated
 *
 * POST /api/webhooks/shopify/order-updated
 *
 * Merge-upserts Shopify-owned fields into Firestore `orders` (feature-flagged).
 * Does not run WhatsApp journeys (create webhook owns that).
 */

import { NextRequest, NextResponse } from 'next/server'
import { readAndVerifyShopifyWebhook } from '@/src/services/orders/shopifyWebhookVerify'
import { upsertShopifyOrderToFirestore } from '@/src/services/orders/shopifyFirestoreUpsert'

export async function POST(req: NextRequest) {
  try {
    const verified = await readAndVerifyShopifyWebhook(req)
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status })
    }

    const orderData = verified.order
    console.log(`\n📦 Shopify orders/updated: ${orderData.name || orderData.id}`)

    const upsert = await upsertShopifyOrderToFirestore(orderData)
    if (upsert.skipped) {
      return NextResponse.json({ status: 'skipped', reason: upsert.reason }, { status: 200 })
    }

    return NextResponse.json({ status: 'success', docId: upsert.docId }, { status: 200 })
  } catch (error: any) {
    console.error('❌ Shopify order-updated webhook error:', error)
    return NextResponse.json({ status: 'error', message: error.message }, { status: 200 })
  }
}
