export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  assignAayshAwb,
  createAayshOrder,
  getAayshOrder,
} from '@/src/services/aayshExpressClient'
import {
  buildAayshOrderFromShopify,
  defaultAayshPickupSchedule,
} from '@/src/services/orders/buildAayshOrderFromShopify'
import { storePhone, storePhoneByChannel } from '@/src/services/phoneStore'

function cleanOrderName(name?: string | null): string {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
}

function patchOrderWithAirExpress(params: {
  order: any
  externalOrderId: string
  shipmentId: string | null
  awb?: string | null
  courier?: string | null
}) {
  const nowIso = new Date().toISOString()
  const shipmentStatus = params.awb ? 'pickup_scheduled' : 'processing'
  const fulfillment = {
    id: Number(params.shipmentId) || Math.floor(Math.random() * 1_000_000),
    status: 'success',
    tracking_number: params.awb || null,
    tracking_company: params.courier || 'Air Express',
    tracking_url: null,
    shipment_status: shipmentStatus,
    shipment_status_reason: params.awb ? 'AWB assigned' : 'Order created',
    created_at: nowIso,
    dispatch_date: nowIso,
    delivery_date: null,
  }

  return OrderRepository.patchOrderInCache(params.order.id, {
    airExpressOrderId: params.externalOrderId,
    fulfillment_status: 'fulfilled',
    fulfillments: [fulfillment],
    logistics: 'air_express',
  })
}

/**
 * Ship a confirmed Shopify order on Aaysh Air Express using the original order number.
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

    const pickupLocation =
      body.pickupLocation ||
      process.env.AAYSH_EXPRESS_PICKUP_LOCATION?.trim() ||
      'Primary'

    const serviceTypeRaw = String(body.serviceType || body.service_type || 'surface')
      .trim()
      .toLowerCase()
    const serviceType = ['surface', 'air', 'prime'].includes(serviceTypeRaw)
      ? serviceTypeRaw
      : 'surface'

    let externalOrderId = channelOrderId
    let shipmentId: string | null = null
    let awb: string | null = order.fulfillments?.[0]?.tracking_number || null
    let courier: string | null = order.fulfillments?.[0]?.tracking_company || null
    let createResult: any = null
    let assignResult: any = null

    // Re-use existing Aaysh order when already linked or found by external id
    if (order.airExpressOrderId) {
      externalOrderId = String(order.airExpressOrderId)
    }

    try {
      const existing = await getAayshOrder(externalOrderId)
      const data = existing?.data || existing
      shipmentId =
        data?.shipment?.shipment_id ||
        data?.shipment_id ||
        existing?.shipment_id ||
        null
      awb = data?.shipment?.awb || data?.awb || existing?.awb_code || awb
      courier = data?.shipment?.courier || data?.courier_name || courier
    } catch {
      // not on Aaysh yet
    }

    if (!shipmentId) {
      const payload = buildAayshOrderFromShopify(order, pickupLocation)
      try {
        createResult = await createAayshOrder(payload)
        externalOrderId = createResult?.order_id || externalOrderId
        shipmentId = createResult?.shipment_id || null
        awb = createResult?.awb_code || awb
        courier = createResult?.courier_name || courier
      } catch (err: any) {
        const msg = String(err?.message || err)
        if (!/duplicate/i.test(msg)) throw err
        const existing = await getAayshOrder(channelOrderId)
        const data = existing?.data || existing
        externalOrderId = channelOrderId
        shipmentId = data?.shipment?.shipment_id || existing?.shipment_id || null
        awb = data?.shipment?.awb || existing?.awb_code || awb
        courier = data?.shipment?.courier || existing?.courier_name || courier
      }
    }

    if (!shipmentId) {
      return NextResponse.json(
        { error: 'Aaysh order created but no shipment id returned. Check Air Express dashboard.' },
        { status: 502 },
      )
    }

    // Before AWB: if address is empty on Aaysh, patch delivery location (legacy API)
    if (shipmentId && !awb) {
      try {
        const existing = await getAayshOrder(externalOrderId)
        const data = existing?.data || existing
        const pincode = String(
          data?.shipping_address?.pincode ||
            data?.shipping?.zip ||
            data?.destinationPincode ||
            '',
        ).trim()
        if (!pincode) {
          const payload = buildAayshOrderFromShopify(order, pickupLocation)
          const { updateAayshDeliveryLocation } = await import(
            '@/src/services/aayshExpressClient'
          )
          await updateAayshDeliveryLocation({
            order_id: externalOrderId,
            shipping_customer_name: payload.shipping.firstName,
            shipping_phone: payload.phone,
            shipping_address: payload.shipping.address1,
            shipping_address_2: payload.shipping.address2 || '',
            shipping_city: payload.shipping.city,
            shipping_state: payload.shipping.province,
            shipping_country: payload.shipping.country || 'India',
            shipping_pincode: payload.shipping.zip,
            shipping_email: payload.email || '',
          })
        }
      } catch (err) {
        console.warn('⚠️ Air Express delivery address patch skipped:', (err as Error)?.message)
      }
    }

    if (!awb) {
      const schedule = defaultAayshPickupSchedule()
      try {
        assignResult = await assignAayshAwb({
          serviceType,
          shipments: [String(shipmentId)],
          pickupDate: schedule.pickupDate,
          pickupTime: schedule.pickupTime,
          pickupLocation,
          notes: `CRM ship confirmed order ${order.name}`,
        })
        const assigned = assignResult?.data?.[0] || assignResult?.data || assignResult
        awb = assigned?.awbNumber || assigned?.awb || awb
        courier = assigned?.courier || assigned?.courierName || courier
      } catch (err: any) {
        return NextResponse.json(
          {
            error: `Air Express order created but AWB assign failed: ${err?.message || err}`,
            externalOrderId,
            shipmentId,
          },
          { status: 502 },
        )
      }
    }

    const phone = order.customer?.phone || order.shipping_address?.phone || ''
    if (phone) {
      storePhone(order.id, phone)
      storePhoneByChannel(channelOrderId, phone)
    }

    const updated = patchOrderWithAirExpress({
      order,
      externalOrderId,
      shipmentId: String(shipmentId),
      awb,
      courier,
    })

    try {
      const { resetAirExpressMatchIndexCache } = await import(
        '@/src/services/orders/airExpressOrderMatch'
      )
      resetAirExpressMatchIndexCache()
    } catch {
      // non-fatal
    }

    return NextResponse.json({
      ok: true,
      provider: 'air_express',
      orderName: order.name,
      externalOrderId,
      shipmentId,
      awb,
      courier,
      order: updated,
      createResult,
      assignResult,
      warning: awb
        ? null
        : 'Order is on Air Express but AWB is still pending. Assign AWB from Air Express panel.',
    })
  } catch (error: any) {
    console.error('air-express ship-confirmed-order failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to ship on Air Express' },
      { status: 500 },
    )
  }
}
