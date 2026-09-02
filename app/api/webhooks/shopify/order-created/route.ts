/**
 * Shopify Webhook — Order Created
 *
 * POST /api/webhooks/shopify/order-created
 *
 * Critical path (must finish before we reply — Shopify 5s timeout):
 *  1. HMAC verify
 *  2. Merge order into live snapshot + Firestore so Order Status shows it instantly
 *  3. Create COD confirmation care task immediately
 *
 * Slow path (after response): WhatsApp journey / AiSensy Day 0.
 */

import { after, NextRequest, NextResponse } from 'next/server'
import { createJourneyFromOrder } from '@/src/services/journey.service'
import { readAndVerifyShopifyWebhook } from '@/src/services/orders/shopifyWebhookVerify'
import { upsertShopifyOrderToFirestore } from '@/src/services/orders/shopifyFirestoreUpsert'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { isCodOrder } from '@/src/utils/orderPayment'

function stampPaymentMethod(order: Record<string, any>) {
  if (!order.payment_method && isCodOrder(order)) {
    order.payment_method = 'cod'
  }
  if (!order.source) order.source = 'shopify'
  return order
}

async function createCodConfirmationImmediately(orderData: Record<string, any>) {
  if (!isCodOrder(orderData)) return { created: false, reason: 'not_cod' }
  if (orderData.test === true || orderData.is_test_order === true) {
    return { created: false, reason: 'test_order' }
  }

  const { assignCareExecutiveForOrder, resolveDefaultCareAssignee } = await import(
    '@/src/services/careTasks/assignmentEngine'
  )
  const { ensureCodConfirmationTask } = await import('@/src/services/careTasks/generator')
  const { storeCareOrderAssignment } = await import('@/src/services/careAssignmentStore')

  let assignee = await assignCareExecutiveForOrder(orderData)
  if (!assignee) {
    try {
      assignee = await resolveDefaultCareAssignee()
    } catch (e) {
      console.warn('COD task: default assignee unavailable:', e)
    }
  }

  if (assignee) {
    storeCareOrderAssignment({
      orderId: orderData.id,
      orderName: orderData.name,
      assignee,
    })
  }

  const task = await ensureCodConfirmationTask(orderData, assignee ?? null)
  return { created: Boolean(task), taskId: task?.id || null, assignee: assignee?.email || null }
}

export async function POST(req: NextRequest) {
  try {
    const verified = await readAndVerifyShopifyWebhook(req)
    if (!verified.ok) {
      console.error('❌ Shopify webhook signature verification failed')
      return NextResponse.json({ error: verified.error }, { status: verified.status })
    }

    const orderData = stampPaymentMethod(verified.order)

    console.log(`\n📦 Shopify Webhook Received: Order ${orderData.name || orderData.id}`)

    // 1. Instant panel: memory/disk snapshot first so list APIs see the order now
    try {
      OrderRepository.applyShopifyOrderToLocalSnapshot(orderData)
    } catch (e) {
      console.warn('⚠️ Failed to apply Shopify order to local snapshot:', e)
    }

    try {
      const upsert = await upsertShopifyOrderToFirestore(orderData)
      if (upsert.skipped) {
        console.log(`ℹ️ Orders Firestore write skipped: ${upsert.reason}`)
      } else {
        console.log(`✅ Orders Firestore upserted: ${upsert.docId}`)
      }
    } catch (e) {
      console.error('⚠️ Shopify→Firestore upsert failed (panel snapshot still applied):', e)
    }

    const customer = orderData.customer || {}
    const shippingAddress = orderData.shipping_address || orderData.billing_address || {}

    const customerName =
      [customer.first_name || shippingAddress.first_name || '', customer.last_name || shippingAddress.last_name || '']
        .join(' ')
        .trim() || 'Customer'

    const customerPhone =
      customer.phone || shippingAddress.phone || orderData.phone || ''

    const customerEmail = customer.email || orderData.email || ''
    const isTestOrder = orderData.test === true

    if (isTestOrder) {
      console.log(
        `🧪 Shopify Order ${orderData.name || orderData.id} is a test order — skipping WhatsApp journey`,
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

    // 2. COD confirmation task BEFORE WhatsApp — must not wait on AiSensy
    let codResult: { created: boolean; taskId?: string | null; assignee?: string | null; reason?: string } = {
      created: false,
    }
    try {
      codResult = await createCodConfirmationImmediately(orderData)
      if (codResult.created) {
        console.log(
          `✅ COD confirmation task created immediately: ${codResult.taskId} (${codResult.assignee || 'unassigned'})`,
        )
      } else if (codResult.reason && codResult.reason !== 'not_cod') {
        console.log(`ℹ️ COD confirmation skipped: ${codResult.reason}`)
      }
    } catch (e) {
      console.warn('Failed to create COD confirmation task:', e)
    }

    const products = (orderData.line_items || []).map(
      (item: any) => item.title || item.name || 'Product',
    )
    const orderAmount = parseFloat(orderData.total_price || '0')

    const runJourney = async () => {
      if (!customerPhone) {
        console.warn('⚠️ No phone number found in order — skipping WhatsApp journey')
        return
      }
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
      console.log(`✅ Webhook journey processed: ${result.journeyId}`)
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
    }

    // 3. WhatsApp after we reply so Shopify doesn't time out / delay COD + panel
    after(() => {
      void runJourney().catch((e) => console.error('⚠️ WhatsApp journey failed:', e))
    })

    return NextResponse.json(
      {
        status: 'success',
        orderId: orderData.id,
        orderName: orderData.name,
        codTaskCreated: codResult.created,
        confirmationQueued: Boolean(customerPhone),
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
