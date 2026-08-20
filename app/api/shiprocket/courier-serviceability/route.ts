export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { checkShiprocketServiceability } from '@/src/services/shiprocketClient'
import { isCodOrder } from '@/src/utils/orderPayment'

function zipFromOrder(order: any): string {
  const raw =
    order?.shipping_address?.zip ||
    order?.billing_address?.zip ||
    order?.customer?.default_address?.zip ||
    ''
  return String(raw).replace(/\D/g, '').slice(0, 6)
}

/**
 * GET ?orderId= — courier rates for Shiprocket lane (pickup → delivery).
 */
export async function GET(req: NextRequest) {
  try {
    const orderId = req.nextUrl.searchParams.get('orderId')
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const order = await OrderRepository.getCachedOrderById(orderId)
    if (!order) {
      return NextResponse.json({ error: 'Order not found in cache' }, { status: 404 })
    }

    const deliveryPostcode = zipFromOrder(order)
    if (!deliveryPostcode || deliveryPostcode.length < 6) {
      return NextResponse.json(
        { error: 'Order has no valid delivery pincode' },
        { status: 400 },
      )
    }

    const pickupPostcode =
      process.env.SHIPROCKET_PICKUP_POSTCODE?.replace(/\D/g, '') ||
      process.env.AAYSH_EXPRESS_PICKUP_PINCODE?.replace(/\D/g, '') ||
      '201304'

    const weight = Number(req.nextUrl.searchParams.get('weight') || 0.45)
    const couriers = await checkShiprocketServiceability({
      pickupPostcode,
      deliveryPostcode,
      weight,
      cod: isCodOrder(order),
      length: 15,
      breadth: 10,
      height: 5,
    })

    return NextResponse.json({
      ok: true,
      provider: 'shiprocket',
      orderId: order.id,
      orderName: order.name,
      pickupPostcode,
      deliveryPostcode,
      weight,
      couriers,
    })
  } catch (error: any) {
    console.error('shiprocket courier-serviceability failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to load Shiprocket courier rates' },
      { status: 500 },
    )
  }
}
