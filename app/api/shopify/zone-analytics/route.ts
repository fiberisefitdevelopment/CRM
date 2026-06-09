export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { buildZoneStats, ZONES } from '@/lib/india-zones'

export async function GET(req: NextRequest) {
  try {
    // Fetch orders from existing Shopify cache endpoint
    const baseUrl = req.nextUrl.origin
    const ordersRes = await fetch(`${baseUrl}/api/shopify/orders?all=true`, {
      headers: { cookie: req.headers.get('cookie') || '' },
    })

    if (!ordersRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 502 })
    }

    const data = await ordersRes.json()
    const orders: any[] = data.orders || []

    // Build zone-level aggregations
    const zoneStats = buildZoneStats(orders)

    // Compute total for percentage calculations
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0)

    const result = ZONES.map((zone) => {
      const stats = zoneStats[zone]
      const deliveryRate = stats.orderCount > 0
        ? Math.round((stats.deliveredCount / stats.orderCount) * 100)
        : 0
      const codPct = stats.orderCount > 0
        ? Math.round((stats.codCount / stats.orderCount) * 100)
        : 0
      const rtoPct = stats.orderCount > 0
        ? Math.round((stats.rtoCount / stats.orderCount) * 100)
        : 0
      const revenueShare = totalRevenue > 0
        ? Math.round((stats.revenue / totalRevenue) * 100)
        : 0

      // Top states by order count
      const topStates = Object.entries(stats.states)
        .sort(([, a], [, b]) => b.orderCount - a.orderCount)
        .slice(0, 5)
        .map(([state, s]) => ({ state, ...s }))

      return {
        zone,
        orderCount: stats.orderCount,
        revenue: Math.round(stats.revenue),
        codCount: stats.codCount,
        deliveredCount: stats.deliveredCount,
        rtoCount: stats.rtoCount,
        deliveryRate,
        codPct,
        rtoPct,
        revenueShare,
        color: stats.color,
        topStates,
      }
    })

    return NextResponse.json({
      zones: result,
      totalOrders,
      totalRevenue: Math.round(totalRevenue),
      isOffline: data.isOffline || false,
    })
  } catch (err: any) {
    console.error('Zone analytics error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
