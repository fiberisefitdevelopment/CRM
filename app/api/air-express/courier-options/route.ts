export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listAayshCouriers } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'
import { OrderRepository } from '@/src/repositories/orderRepository'

function zipFromOrder(order: any): string {
  const raw =
    order?.shipping_address?.zip ||
    order?.billing_address?.zip ||
    order?.customer?.default_address?.zip ||
    ''
  return String(raw).replace(/\D/g, '').slice(0, 6)
}

/**
 * Courier / service options for Air Express ship flow.
 * Aaysh does not expose a public rate API — we return service types + active couriers.
 */
export async function GET(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const orderId = req.nextUrl.searchParams.get('orderId')
    if (!orderId) throw new Error('orderId is required')

    const order = await OrderRepository.getCachedOrderById(orderId)
    if (!order) {
      const err = new Error('Order not found in cache') as Error & { status: number }
      err.status = 404
      throw err
    }

    const deliveryPostcode = zipFromOrder(order)
    let courierList: any[] = []
    try {
      const raw = await listAayshCouriers()
      courierList = Array.isArray(raw?.couriers)
        ? raw.couriers
        : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
            ? raw
            : []
    } catch {
      courierList = []
    }

    const services = [
      {
        id: 'surface',
        serviceType: 'surface',
        name: 'Surface',
        rate: null as number | null,
        rateLabel: 'As per contract',
        etd: 'Standard transit',
        description: 'Economy surface delivery — auto courier by priority',
      },
      {
        id: 'air',
        serviceType: 'air',
        name: 'Air',
        rate: null as number | null,
        rateLabel: 'As per contract',
        etd: 'Faster transit',
        description: 'Air service — auto courier by priority',
      },
      {
        id: 'prime',
        serviceType: 'prime',
        name: 'Prime',
        rate: null as number | null,
        rateLabel: 'As per contract',
        etd: 'Priority transit',
        description: 'Prime service — auto courier by priority',
      },
    ]

    const couriers = courierList.map((c: any, idx: number) => ({
      id: String(c._id || c.courier_name || c.name || idx),
      name: String(c.courier_name || c.name || 'Courier'),
      rate: null as number | null,
      rateLabel: 'As per contract',
      etd: null as string | null,
      supportsPrime: Boolean(c.supports_prime ?? c.supportsPrime),
      active: c.active !== false,
    }))

    return {
      ok: true,
      provider: 'air_express',
      orderId: order.id,
      orderName: order.name,
      deliveryPostcode,
      services,
      couriers,
      note:
        'Aaysh assigns AWB by service type and courier priority. Select a service, then confirm.',
    }
  })
}
