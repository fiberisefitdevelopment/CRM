/**
 * Shopify Webhook — Order Created
 *
 * POST /api/webhooks/shopify/order-created
 *
 *  1. Verifies HMAC-SHA256 signature
 *  2. Phase 3: merge-upserts Shopify fields into Firestore `orders` (if flagged)
 *  3. Creates WhatsApp journey in Firestore (unchanged)
 *  4. Triggers Day 0 order confirmation via AiSensy (unchanged)
 *
 * Shopify has a 5-second timeout for webhook responses,
 * so we keep processing lean.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createJourneyFromOrder } from '@/src/services/journey.service'
import { readAndVerifyShopifyWebhook } from '@/src/services/orders/shopifyWebhookVerify'
import { upsertShopifyOrderToFirestore } from '@/src/services/orders/shopifyFirestoreUpsert'

export async function POST(req: NextRequest) {
  try {
    const verified = await readAndVerifyShopifyWebhook(req)
    if (!verified.ok) {
      console.error('❌ Shopify webhook signature verification failed')
      return NextResponse.json({ error: verified.error }, { status: verified.status })
    }

    const orderData = verified.order

    console.log(`\n📦 Shopify Webhook Received: Order ${orderData.name || orderData.id}`)

    // Phase 3: keep Firestore in sync (feature-flagged). Does not affect journey flow.
    try {
      const upsert = await upsertShopifyOrderToFirestore(orderData)
      if (upsert.skipped) {
        console.log(`ℹ️ Orders Firestore write skipped: ${upsert.reason}`)
      } else {
        console.log(`✅ Orders Firestore upserted: ${upsert.docId}`)
      }
    } catch (e) {
      console.error('⚠️ Shopify→Firestore upsert failed (journey continues):', e)
    }

    // Extract customer info
    const customer = orderData.customer || {}
    const shippingAddress = orderData.shipping_address || orderData.billing_address || {}

    const customerName =
      [customer.first_name || shippingAddress.first_name || '', customer.last_name || shippingAddress.last_name || '']
        .join(' ')
        .trim() || 'Customer'

    const customerPhone =
      customer.phone || shippingAddress.phone || orderData.phone || ''

    const customerEmail = customer.email || orderData.email || ''

    // Validate phone — required for WhatsApp
    if (!customerPhone) {
      console.warn('⚠️ No phone number found in order — skipping WhatsApp journey')
      return NextResponse.json(
        { status: 'skipped', reason: 'no_phone_number' },
        { status: 200 },
      )
    }

    // Check if Shopify test order
    const isTestOrder = orderData.test === true
    if (isTestOrder) {
      console.log(
        `🧪 Shopify Order ${orderData.name || orderData.id} is a test order — skipping WhatsApp journey and registering in Firestore`,
      )

      try {
        const { markOrderAsTest } = require('@/src/services/firestore.service')
        const ipAddress =
          req.headers.get('x-real-ip') ||
          req.headers.get('x-forwarded-for')?.split(',')[0] ||
          (req as any).ip ||
          '127.0.0.1'
        await markOrderAsTest(String(orderData.id), true, {
          markedBy: 'shopify_webhook',
          ip: ipAddress,
          device: 'Shopify Webhook',
        })
      } catch (e) {
        console.error('Failed to automatically mark Shopify test order in DB:', e)
      }

      return NextResponse.json({ status: 'skipped', reason: 'test_order' }, { status: 200 })
    }

    // Extract product names
    const products = (orderData.line_items || []).map(
      (item: any) => item.title || item.name || 'Product',
    )

    // Extract order amount
    const orderAmount = parseFloat(orderData.total_price || '0')

    // Create journey — this handles customer upsert + journey doc + Day 0 confirmation
    const result = await createJourneyFromOrder({
      orderId: orderData.name || `#${orderData.id}`,
      orderAmount,
      products,
      customer: {
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
      },
    })

    console.log(`✅ Webhook processed: Journey ${result.journeyId} created`)

    // Display-only tag on Orders / Order Status when AiSensy confirmation is sent
    if (result.confirmationSent) {
      try {
        const { storeCareOrderTag } = require('@/src/services/careOrderTagStore')
        storeCareOrderTag({
          orderId: orderData.id,
          orderName: orderData.name,
          kind: 'aisensy_confirmed',
          byEmail: 'aisensy',
          byName: 'AiSensy',
        })
      } catch (e) {
        console.warn('Failed to store AiSensy care tag:', e)
      }
    }

    return NextResponse.json(
      {
        status: 'success',
        journeyId: result.journeyId,
        customerId: result.customerId,
        confirmationSent: result.confirmationSent,
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('❌ Shopify webhook error:', error)

    // Still return 200 to prevent Shopify from retrying
    // (we don't want duplicate journeys from retries)
    return NextResponse.json({ status: 'error', message: error.message }, { status: 200 })
  }
}
