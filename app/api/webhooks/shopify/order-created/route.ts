/**
 * Shopify Webhook — Order Created
 *
 * POST /api/webhooks/shopify/order-created
 *
 * Receives Shopify's "orders/create" webhook:
 *  1. Verifies HMAC-SHA256 signature
 *  2. Extracts customer + order data
 *  3. Creates journey in Firestore
 *  4. Triggers Day 0 order confirmation via AiSensy
 *
 * Shopify has a 5-second timeout for webhook responses,
 * so we return 200 quickly and process asynchronously.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createJourneyFromOrder } from '@/src/services/journey.service';

// ─── Webhook Signature Verification ───────────────────────────────────────────

/**
 * Verify the Shopify webhook HMAC-SHA256 signature.
 */
function verifyShopifyWebhook(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('❌ SHOPIFY_WEBHOOK_SECRET not configured');
    return false;
  }

  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  );
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await req.text();

    // Verify webhook signature
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';

    if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
      console.error('❌ Shopify webhook signature verification failed');
      return NextResponse.json(
        { error: 'Webhook verification failed' },
        { status: 401 }
      );
    }

    // Parse the order data
    const orderData = JSON.parse(rawBody);

    console.log(`\n📦 Shopify Webhook Received: Order ${orderData.name || orderData.id}`);

    // Extract customer info
    const customer = orderData.customer || {};
    const shippingAddress = orderData.shipping_address || orderData.billing_address || {};

    const customerName = [
      customer.first_name || shippingAddress.first_name || '',
      customer.last_name || shippingAddress.last_name || '',
    ]
      .join(' ')
      .trim() || 'Customer';

    const customerPhone =
      customer.phone ||
      shippingAddress.phone ||
      orderData.phone ||
      '';

    const customerEmail =
      customer.email ||
      orderData.email ||
      '';

    // Validate phone — required for WhatsApp
    if (!customerPhone) {
      console.warn('⚠️ No phone number found in order — skipping WhatsApp journey');
      return NextResponse.json(
        { status: 'skipped', reason: 'no_phone_number' },
        { status: 200 }
      );
    }

    // Check if Shopify test order
    const isTestOrder = orderData.test === true;
    if (isTestOrder) {
      console.log(`🧪 Shopify Order ${orderData.name || orderData.id} is a test order — skipping WhatsApp journey and registering in Firestore`);
      
      // Save as a test order in Firestore
      try {
        const { markOrderAsTest } = require('@/src/services/firestore.service');
        const ipAddress = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || (req as any).ip || '127.0.0.1';
        await markOrderAsTest(String(orderData.id), true, {
          markedBy: 'shopify_webhook',
          ip: ipAddress,
          device: 'Shopify Webhook'
        });
      } catch (e) {
        console.error('Failed to automatically mark Shopify test order in DB:', e);
      }

      return NextResponse.json(
        { status: 'skipped', reason: 'test_order' },
        { status: 200 }
      );
    }


    // Extract product names
    const products = (orderData.line_items || []).map(
      (item: any) => item.title || item.name || 'Product'
    );

    // Extract order amount
    const orderAmount = parseFloat(orderData.total_price || '0');

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
    });

    console.log(`✅ Webhook processed: Journey ${result.journeyId} created`);

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

    // Return 200 quickly (Shopify requires fast response)
    return NextResponse.json(
      {
        status: 'success',
        journeyId: result.journeyId,
        customerId: result.customerId,
        confirmationSent: result.confirmationSent,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('❌ Shopify webhook error:', error);

    // Still return 200 to prevent Shopify from retrying
    // (we don't want duplicate journeys from retries)
    return NextResponse.json(
      { status: 'error', message: error.message },
      { status: 200 }
    );
  }
}
