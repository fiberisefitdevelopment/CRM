export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  checkShipwayCarrierRates,
  getShipwayCarriers,
} from '@/src/services/shipwayClient'
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
 * GET ?orderId= — courier rates for Shipway delivery to order destination.
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

    const isCod = isCodOrder(order)
    const paymentType = isCod ? 'cod' : 'prepaid'
    const weight = Number(req.nextUrl.searchParams.get('weight') || 0.45)

    let courierOptions: any[] = []

    try {
      const ratesResp = await checkShipwayCarrierRates({
        toPincode: deliveryPostcode,
        paymentType,
        weight,
      })

      const rateCard = ratesResp?.rate_card || []
      courierOptions = rateCard.map((item) => {
        const baseCharge = Number(item.delivery_charge) || 0
        const codCharge = isCod ? Number(item.cod_charges || 0) : 0
        const totalRate = Math.round((baseCharge + codCharge) * 100) / 100

        return {
          id: String(item.carrier_id),
          carrier_id: item.carrier_id,
          name: item.courier_name,
          rate: totalRate,
          delivery_charge: baseCharge,
          cod_charge: codCharge,
          rto_charge: item.rto_charge,
          etd: item.zone ? `Zone ${item.zone}` : 'Standard transit',
          zone: item.zone,
        }
      })
    } catch (ratesErr: any) {
      console.warn('⚠️ Shipway live rates query failed, loading carrier catalog:', ratesErr?.message)
    }

    // Fallback to active carrier catalog if rate card was empty
    if (courierOptions.length === 0) {
      try {
        const carriersResp = await getShipwayCarriers()
        const carriers = Array.isArray(carriersResp?.message)
          ? carriersResp.message
          : Array.isArray(carriersResp?.data)
            ? carriersResp.data
            : []

        courierOptions = carriers.map((c: any) => ({
          id: String(c.id),
          carrier_id: Number(c.id),
          name: c.carrier_title || c.name || 'Shipway Partner',
          rate: null,
          rateLabel: 'As per contract',
          etd: 'Standard transit',
        }))
      } catch (carrierErr: any) {
        console.warn('⚠️ Shipway carriers query failed:', carrierErr?.message)
      }
    }

    return NextResponse.json({
      ok: true,
      provider: 'shipway',
      orderId: order.id,
      orderName: order.name,
      deliveryPostcode,
      paymentType,
      couriers: courierOptions,
    })
  } catch (error: any) {
    console.error('Shipway courier-options error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch Shipway delivery partners' },
      { status: 500 },
    )
  }
}
