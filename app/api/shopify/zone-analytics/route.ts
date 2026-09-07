export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { buildZoneStats, ZONES } from '@/lib/india-zones'
import { loadOrdersForAnalytics } from '@/src/services/analyticsOrders'

export async function GET() {
  try {
    const { orders, cacheEmpty } = await loadOrdersForAnalytics({ includeTest: false })

    if (cacheEmpty) {
      return NextResponse.json({
        zones: [],
        totalOrders: 0,
        totalRevenue: 0,
        isOffline: false,
        syncing: true,
      })
    }

    const zoneStats = buildZoneStats(orders)
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
      isOffline: false,
    })
  } catch (err: any) {
    console.error('Zone analytics error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
