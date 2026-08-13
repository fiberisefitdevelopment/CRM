export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  assignShiprocketAwb,
  createShiprocketAdhocOrder,
  findShiprocketOrderByChannelNumber,
  scheduleShiprocketPickup,
  type ShiprocketAdhocOrderPayload,
} from '@/src/services/shiprocketClient'
import { getPaymentLabel } from '@/src/utils/orderPayment'
import { storePhone, storePhoneByChannel } from '@/src/services/phoneStore'

function cleanOrderName(name?: string | null): string {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
}

function buildAdhocPayload(order: any): ShiprocketAdhocOrderPayload {
  const channelOrderId = cleanOrderName(order.name)
  const orderItems = (order.line_items || []).map((item: any) => ({
    name: item.title || 'Starter pack',
    sku: item.sku || 'test pack',
    units: Number(item.quantity) || 1,
    selling_price: Number(item.price) || 0,
  }))

  const rawPhone = order.customer?.phone || order.shipping_address?.phone || '9999999999'
  const sanitizedPhone = String(rawPhone).replace(/[^0-9]/g, '').slice(-10) || '9999999999'
  const rawZip = order.shipping_address?.zip || '400001'
  const sanitizedZip = Number(String(rawZip).replace(/[^0-9]/g, '')) || 400001

  return {
    order_id: channelOrderId,
    order_date: (order.created_at || new Date().toISOString()).slice(0, 10),
    pickup_location: 'Primary',
    billing_customer_name:
      order.customer?.first_name || order.shipping_address?.first_name || 'Guest',
    billing_last_name: order.customer?.last_name || order.shipping_address?.last_name || '',
    billing_address: order.shipping_address?.address1 || 'N/A',
    billing_address_2: order.shipping_address?.address2 || '',
    billing_city: order.shipping_address?.city || 'Mumbai',
    billing_pincode: sanitizedZip,
    billing_state: order.shipping_address?.province || 'Maharashtra',
    billing_country: order.shipping_address?.country || 'India',
    billing_email: order.customer?.email || 'customer@example.com',
    billing_phone: sanitizedPhone,
    shipping_is_billing: true,
    order_items: orderItems.length
      ? orderItems
      : [
          {
            name: 'Starter pack',
            sku: 'test pack',
            units: 1,
            selling_price: Number(order.total_price) || 0,
          },
        ],
    payment_method: getPaymentLabel(order),
    sub_total: Number(order.total_price) || 0,
    length: 15,
    breadth: 10,
    height: 5,
    weight: 0.45,
  }
}

function patchShopifyOrderWithShipment(params: {
  order: any
  shiprocketOrderId: number | string
  shipmentId: number | string | null
  awb?: string | null
  courier?: string | null
  trackingUrl?: string | null
  statusLabel?: string | null
}) {
  const nowIso = new Date().toISOString()
  const shipmentStatus = params.awb ? 'pickup_scheduled' : 'processing'
  const fulfillment = {
    id: Number(params.shipmentId) || Math.floor(Math.random() * 1_000_000),
    status: 'success',
    tracking_number: params.awb || null,
    tracking_company: params.courier || null,
    tracking_url: params.trackingUrl || null,
    shipment_status: shipmentStatus,
    shipment_status_reason: params.statusLabel || null,
    created_at: nowIso,
    dispatch_date: nowIso,
    delivery_date: null,
  }

  return OrderRepository.patchOrderInCache(params.order.id, {
    fulfillment_status: 'fulfilled',
    shiprocket_order_id: params.shiprocketOrderId,
    shiprocketOrderId: params.shiprocketOrderId,
    shiprocket_meta: {
      ...(params.order.shiprocket_meta || {}),
      status: params.statusLabel || (params.awb ? 'PICKUP SCHEDULED' : 'NEW'),
      awb: params.awb || null,
      courier: params.courier || null,
      shipment_id: params.shipmentId,
      channel_order_id: cleanOrderName(params.order.name),
    },
    fulfillments: [fulfillment],
  })
}

/**
 * Ship a confirmed Shopify order on Shiprocket using the ORIGINAL order number.
 * Does NOT create a -C clone order.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orderId = body.orderId ?? body.id
    if (orderId == null || orderId === '') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const order = await OrderRepository.getCachedOrderById(orderId)
    if (!order) {
      return NextResponse.json({ error: 'Order not found in cache. Refresh Orders first.' }, { status: 404 })
    }

    const channelOrderId = cleanOrderName(order.name)
    if (!channelOrderId) {
      return NextResponse.json({ error: 'Order has no name/number to ship' }, { status: 400 })
    }

    // Refuse to ship an existing clone as a confirmed source order
    if (/-c$/i.test(channelOrderId)) {
      return NextResponse.json(
        { error: 'This looks like a clone order. Ship the original confirmed order instead.' },
        { status: 400 },
      )
    }

    let shiprocketOrderId: number | string | null = order.shiprocket_order_id || null
    let shipmentId: number | string | null =
      order.shiprocket_meta?.shipment_id || order.fulfillments?.[0]?.id || null
    let awb: string | null = order.fulfillments?.[0]?.tracking_number || null
    let courier: string | null = order.fulfillments?.[0]?.tracking_company || null
    let created = false
    let assignResult: any = null
    let pickupResult: any = null

    // 1) Prefer existing Shiprocket channel order (Shopify sync) — never invent -C
    const existing = await findShiprocketOrderByChannelNumber(channelOrderId)
    if (existing?.id) {
      shiprocketOrderId = existing.id
      shipmentId = existing.shipment_id || shipmentId
      awb = existing.awb || awb
      courier = existing.courier || courier
    }

    // 2) If missing on Shiprocket, create adhoc with the SAME channel order id
    if (!shiprocketOrderId || !shipmentId) {
      const payload = buildAdhocPayload(order)
      try {
        const createdRes = await createShiprocketAdhocOrder(payload)
        if (createdRes?.status_code === 0) {
          // Often means the channel order already exists — re-fetch
          const again = await findShiprocketOrderByChannelNumber(channelOrderId)
          if (!again?.id) {
            return NextResponse.json(
              {
                error: createdRes.message || 'Shiprocket rejected create for this order',
                details: createdRes,
              },
              { status: 400 },
            )
          }
          shiprocketOrderId = again.id
          shipmentId = again.shipment_id
          awb = again.awb || awb
          courier = again.courier || courier
        } else {
          created = true
          shiprocketOrderId = createdRes.order_id || createdRes.orderId || shiprocketOrderId
          shipmentId = createdRes.shipment_id || createdRes.shipmentId || shipmentId
        }
      } catch (err: any) {
        const again = await findShiprocketOrderByChannelNumber(channelOrderId)
        if (!again?.id) throw err
        shiprocketOrderId = again.id
        shipmentId = again.shipment_id
        awb = again.awb || awb
        courier = again.courier || courier
      }
    }

    if (!shiprocketOrderId) {
      return NextResponse.json({ error: 'Could not resolve Shiprocket order id' }, { status: 502 })
    }

    // 3) Assign AWB if we have a shipment and no AWB yet
    if (shipmentId && !awb) {
      try {
        assignResult = await assignShiprocketAwb({
          shipmentId,
          courierId: body.courierId,
        })
        const response = assignResult?.response?.data || assignResult?.data || assignResult
        awb = response?.awb_code || response?.awb || awb
        courier = response?.courier_name || response?.courier || courier
      } catch (err: any) {
        console.warn('⚠️ AWB assign failed (order still pushed):', err?.message || err)
      }
    }

    // 4) Schedule pickup when AWB exists
    if (shipmentId && awb) {
      try {
        pickupResult = await scheduleShiprocketPickup({ shipmentId })
      } catch (err: any) {
        console.warn('⚠️ Pickup schedule failed (AWB still assigned):', err?.message || err)
      }
    }

    const phone = order.customer?.phone || order.shipping_address?.phone || ''
    if (phone) {
      storePhone(order.id, phone)
      storePhoneByChannel(channelOrderId, phone)
    }

    const updated = patchShopifyOrderWithShipment({
      order,
      shiprocketOrderId,
      shipmentId,
      awb,
      courier,
      statusLabel: awb ? 'PICKUP SCHEDULED' : 'READY TO SHIP',
    })

    try {
      const { optionalAuth } = require('@/src/services/auth')
      const { logAction } = require('@/src/services/auditLogService')
      const session = await optionalAuth(req)
      logAction({
        userId: session?.id || 'unknown',
        userEmail: session?.email || 'unknown',
        userRole: session?.role || 'unknown',
        actionType: 'ORDER_SHIP',
        description: `Shipped confirmed order ${order.name} on Shiprocket (no clone)`,
        module: 'orders',
        status: 'success',
        details: {
          shopifyOrderId: order.id,
          orderName: order.name,
          shiprocketOrderId,
          shipmentId,
          awb,
          courier,
          created,
        },
        req,
      })
    } catch {}

    return NextResponse.json({
      success: true,
      cloned: false,
      created,
      orderId: order.id,
      orderName: order.name,
      shiprocketOrderId,
      shipmentId,
      awb,
      courier,
      assignResult,
      pickupResult,
      order: updated,
    })
  } catch (error: any) {
    console.error('ship-confirmed-order failed:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to ship confirmed order' },
      { status: 500 },
    )
  }
}
