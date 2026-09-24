export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  pushShipwayOrder,
  getShipwayCarriers,
  type ShipwayProduct,
  type ShipwayPushOrderPayload,
} from '@/src/services/shipwayClient'
import { isCodOrder } from '@/src/utils/orderPayment'
import { storePhone, storePhoneByChannel } from '@/src/services/phoneStore'

function cleanOrderName(name?: string | null): string {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
}

function formatShipwayDate(dateStr?: string | null): string {
  try {
    const d = dateStr ? new Date(dateStr) : new Date()
    return d.toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return new Date().toISOString().replace('T', ' ').slice(0, 19)
  }
}

function patchOrderWithShipway(params: {
  order: any
  channelOrderId: string
  carrierId?: string | number | null
  courierName?: string | null
  awb?: string | null
  shippingUrl?: string | null
}) {
  const nowIso = new Date().toISOString()
  const shipmentStatus = params.awb ? 'pickup_scheduled' : 'processing'
  const trackingCompany = params.courierName || 'Shipway'
  const trackingUrl =
    params.shippingUrl ||
    (params.awb ? `https://fiberisefit.shipway.com/t/${params.awb}` : null)

  const fulfillment = {
    id: Math.floor(Math.random() * 1_000_000),
    status: 'success',
    tracking_number: params.awb || null,
    tracking_company: trackingCompany,
    tracking_url: trackingUrl,
    shipment_status: shipmentStatus,
    shipment_status_reason: params.awb ? 'AWB assigned via Shipway' : 'Order pushed to Shipway',
    created_at: nowIso,
    dispatch_date: nowIso,
    delivery_date: null,
  }

  return OrderRepository.patchOrderInCache(params.order.id, {
    fulfillment_status: 'fulfilled',
    logistics: 'shipway',
    shipwayOrderId: params.channelOrderId,
    shipwayCarrierId: params.carrierId || null,
    shipwayLabelUrl: params.shippingUrl || null,
    fulfillments: [fulfillment],
  })
}

/**
 * Ship a confirmed Shopify order via Shipway.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orderId = body.orderId ?? body.id
    const carrierId = body.carrierId ?? body.carrier_id ?? null

    if (orderId == null || orderId === '') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const order = await OrderRepository.getCachedOrderById(orderId)
    if (!order) {
      return NextResponse.json(
        { error: 'Order not found in cache. Refresh Orders first.' },
        { status: 404 },
      )
    }

    const channelOrderId = cleanOrderName(order.name)
    if (!channelOrderId) {
      return NextResponse.json({ error: 'Order has no name/number to ship' }, { status: 400 })
    }

    if (/-c$/i.test(channelOrderId)) {
      return NextResponse.json(
        { error: 'This looks like a clone order. Ship the original confirmed order instead.' },
        { status: 400 },
      )
    }

    // Build products array
    const rawItems = order.line_items || []
    const products: ShipwayProduct[] = rawItems.map((item: any) => ({
      product: String(item.title || 'Fiberise Item').slice(0, 100),
      price: String(Number(item.price) || 0),
      product_code: String(item.sku || 'FIB-SKU').slice(0, 50),
      product_quantity: String(Number(item.quantity) || 1),
      discount: '0',
      tax_rate: '0',
      tax_title: 'GST',
    }))

    if (products.length === 0) {
      products.push({
        product: 'Fiberise Wellness Pack',
        price: String(Number(order.total_price) || 0),
        product_code: 'FIB-WELLNESS',
        product_quantity: '1',
        discount: '0',
        tax_rate: '0',
        tax_title: 'GST',
      })
    }

    const isCod = isCodOrder(order)
    const paymentType: 'P' | 'C' = isCod ? 'C' : 'P'

    const rawPhone = order.customer?.phone || order.shipping_address?.phone || '9999999999'
    const sanitizedPhone = String(rawPhone).replace(/[^0-9]/g, '').slice(-10) || '9999999999'

    const firstName =
      order.shipping_address?.first_name ||
      order.customer?.first_name ||
      'Customer'
    const lastName =
      order.shipping_address?.last_name ||
      order.customer?.last_name ||
      ''

    const address1 = order.shipping_address?.address1 || order.billing_address?.address1 || 'A-1'
    const address2 = order.shipping_address?.address2 || order.billing_address?.address2 || ''
    const city = order.shipping_address?.city || order.billing_address?.city || 'Delhi'
    const state = order.shipping_address?.province || order.billing_address?.province || 'Delhi'
    const country = order.shipping_address?.country || 'India'
    const rawZip = order.shipping_address?.zip || order.billing_address?.zip || '110001'
    const zipcode = String(rawZip).replace(/\D/g, '').slice(0, 6) || '110001'
    const email = order.customer?.email || 'care@fiberisefit.com'

    const pushPayload: ShipwayPushOrderPayload = {
      order_id: channelOrderId,
      carrier_id: carrierId ? Number(carrierId) : undefined,
      products,
      discount: '0',
      shipping: '0',
      order_total: String(Number(order.total_price) || 0),
      gift_card_amt: '0',
      taxes: '0',
      payment_type: paymentType,
      email,
      billing_address: address1,
      billing_address2: address2,
      billing_city: city,
      billing_state: state,
      billing_country: country,
      billing_firstname: firstName,
      billing_lastname: lastName,
      billing_phone: sanitizedPhone,
      billing_zipcode: zipcode,
      shipping_address: address1,
      shipping_address2: address2,
      shipping_city: city,
      shipping_state: state,
      shipping_country: country,
      shipping_firstname: firstName,
      shipping_lastname: lastName,
      shipping_phone: sanitizedPhone,
      shipping_zipcode: zipcode,
      order_weight: 450, // grams
      box_length: 15,
      box_breadth: 10,
      box_height: 5,
      order_date: formatShipwayDate(order.created_at),
    }

    const shipwayResult = await pushShipwayOrder(pushPayload)

    if (!shipwayResult.success && !shipwayResult.awb_response?.AWB) {
      const msg = shipwayResult.message || 'Shipway order booking failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const awb = shipwayResult.awb_response?.AWB || null
    const shippingUrl = shipwayResult.awb_response?.shipping_url || null
    let courierName = 'Shipway Partner'

    // Try to resolve human-readable carrier name if carrier_id provided
    if (carrierId) {
      try {
        const carriersData = await getShipwayCarriers()
        const carrierList = Array.isArray(carriersData?.message)
          ? carriersData.message
          : Array.isArray(carriersData?.data)
            ? carriersData.data
            : []
        const matched = carrierList.find((c: any) => String(c.id) === String(carrierId))
        if (matched) {
          courierName = matched.carrier_title || matched.name || courierName
        }
      } catch {
        // Non-fatal fallback
      }
    }

    if (sanitizedPhone) {
      storePhone(order.id, sanitizedPhone)
      storePhoneByChannel(channelOrderId, sanitizedPhone)
    }

    const updated = patchOrderWithShipway({
      order,
      channelOrderId,
      carrierId,
      courierName,
      awb,
      shippingUrl,
    })

    return NextResponse.json({
      ok: true,
      provider: 'shipway',
      orderName: order.name,
      channelOrderId,
      carrierId,
      courier: courierName,
      awb,
      shippingUrl,
      order: updated,
      message: shipwayResult.message,
      warning: awb ? null : 'Order created on Shipway. AWB assignment may be in progress.',
    })
  } catch (error: any) {
    console.error('Shipway ship-confirmed-order error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to ship on Shipway' },
      { status: 500 },
    )
  }
}
