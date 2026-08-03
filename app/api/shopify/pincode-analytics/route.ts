export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getZoneForState, resolveProvince } from '@/lib/india-zones'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const pincodeParam = searchParams.get('pincodes') || ''
    const cityParam    = searchParams.get('city')    || ''
    const stateParam   = searchParams.get('state')   || ''
    const zoneParam    = searchParams.get('zone')    || ''

    // Parse requested pincodes
    const requestedPincodes = pincodeParam
      ? pincodeParam.split(',').map((p) => p.trim()).filter(Boolean)
      : []

    // Fetch all orders
    const baseUrl = req.nextUrl.origin
    const ordersRes = await fetch(`${baseUrl}/api/shopify/orders?all=true`, {
      headers: {
        authorization: req.headers.get('authorization') || '',
      },
    })
    if (!ordersRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 502 })
    }

    const data = await ordersRes.json()
    const allOrders: any[] = data.orders || []

    // Filter orders by pincode / city / state / zone
    const matchedOrders = allOrders.filter((order) => {
      const addr = order.shipping_address
      if (!addr) return false

      const pincode = (addr.zip || '').toString().trim()
      const city    = (addr.city || '').toLowerCase()
      const state   = resolveProvince(addr.province) || ''
      const zone    = getZoneForState(state)

      if (requestedPincodes.length > 0 && !requestedPincodes.includes(pincode)) return false
      if (cityParam && !city.includes(cityParam.toLowerCase())) return false
      if (stateParam && state.toLowerCase() !== stateParam.toLowerCase()) return false
      if (zoneParam && zone !== zoneParam) return false

      return true
    })

    // Aggregate per-pincode stats
    const pincodeMap: Record<string, {
      pincode: string; city: string; state: string; zone: string | null;
      orderCount: number; revenue: number;
      codCount: number; deliveredCount: number; rtoCount: number;
      customerIds: Set<string>; returningCustomerIds: Set<string>
    }> = {}

    const customerOrderCount: Record<string, number> = {}

    // First pass: count orders per customer globally
    allOrders.forEach((order) => {
      const cid = order.customer?.id?.toString()
      if (cid) {
        customerOrderCount[cid] = (customerOrderCount[cid] || 0) + 1
      }
    })

    matchedOrders.forEach((order) => {
      const addr = order.shipping_address
      const pincode  = (addr?.zip || 'Unknown').toString().trim()
      const city     = addr?.city || 'Unknown'
      const state    = resolveProvince(addr?.province) || 'Unknown'
      const zone     = getZoneForState(state)
      const price    = parseFloat(order.total_price) || 0
      const isCOD    = order.financial_status?.toLowerCase() !== 'paid'
      const shipStatus = (order.fulfillments?.[0]?.shipment_status || '').toLowerCase()
      const isDelivered = shipStatus === 'delivered'
      const isRTO       = ['failure', 'rto', 'returned'].includes(shipStatus)
      const cid         = order.customer?.id?.toString()

      if (!pincodeMap[pincode]) {
        pincodeMap[pincode] = {
          pincode, city, state, zone,
          orderCount: 0, revenue: 0,
          codCount: 0, deliveredCount: 0, rtoCount: 0,
          customerIds: new Set(),
          returningCustomerIds: new Set(),
        }
      }

      pincodeMap[pincode].orderCount++
      pincodeMap[pincode].revenue += price
      if (isCOD) pincodeMap[pincode].codCount++
      if (isDelivered) pincodeMap[pincode].deliveredCount++
      if (isRTO) pincodeMap[pincode].rtoCount++
      if (cid) {
        pincodeMap[pincode].customerIds.add(cid)
        if ((customerOrderCount[cid] || 0) > 1) {
          pincodeMap[pincode].returningCustomerIds.add(cid)
        }
      }
    })

    const pincodeResults = Object.values(pincodeMap)
      .map((p) => ({
        pincode:          p.pincode,
        city:             p.city,
        state:            p.state,
        zone:             p.zone,
        orderCount:       p.orderCount,
        revenue:          Math.round(p.revenue),
        aov:              p.orderCount > 0 ? Math.round(p.revenue / p.orderCount) : 0,
        codPct:           p.orderCount > 0 ? Math.round((p.codCount / p.orderCount) * 100) : 0,
        deliveryRate:     p.orderCount > 0 ? Math.round((p.deliveredCount / p.orderCount) * 100) : 0,
        rtoPct:           p.orderCount > 0 ? Math.round((p.rtoCount / p.orderCount) * 100) : 0,
        customerCount:    p.customerIds.size,
        repeatCustomers:  p.returningCustomerIds.size,
        repeatRate:       p.customerIds.size > 0 ? Math.round((p.returningCustomerIds.size / p.customerIds.size) * 100) : 0,
      }))
      .sort((a, b) => b.orderCount - a.orderCount)

    // Summary stats for matched orders
    const totalRevenue = matchedOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0)

    return NextResponse.json({
      pincodes:    pincodeResults,
      summary: {
        totalOrders:   matchedOrders.length,
        totalRevenue:  Math.round(totalRevenue),
        uniquePincodes: pincodeResults.length,
      },
      isOffline: data.isOffline || false,
    })
  } catch (err: any) {
    console.error('Pincode analytics error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
