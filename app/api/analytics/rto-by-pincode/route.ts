export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOrdersForAnalytics } from '@/src/services/analyticsOrders'
import {
  buildRtoByPincodeReport,
  rtoByPincodeReportToCsv,
} from '@/src/services/analytics/rtoByPincode'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const startDate = searchParams.get('start_date') || undefined
    const endDate = searchParams.get('end_date') || undefined
    const datePreset = searchParams.get('date_preset') || undefined
    const format = (searchParams.get('format') || 'json').toLowerCase()

    const { orders, cacheEmpty } = await loadOrdersForAnalytics({
      startDate,
      endDate,
      datePreset,
      includeTest: false,
      refresh: searchParams.get('refresh') === 'true',
    })

    if (cacheEmpty) {
      if (format === 'csv') {
        return new NextResponse('\uFEFFNo orders in cache yet. Refresh orders and try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        })
      }
      return NextResponse.json({
        syncing: true,
        summary: { totalRtoInitiated: 0, uniquePincodesWithRto: 0, totalOrdersInRange: 0 },
        byPincode: [],
        orders: [],
      })
    }

    const report = buildRtoByPincodeReport(orders)
    report.summary.dateStart = startDate
    report.summary.dateEnd = endDate

    if (format === 'csv') {
      const csv = rtoByPincodeReportToCsv(report)
      const stamp = new Date().toISOString().slice(0, 10)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="rto_initiated_by_pincode_${stamp}.csv"`,
        },
      })
    }

    return NextResponse.json(report)
  } catch (err: any) {
    console.error('RTO by pincode analytics error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to build RTO report' }, { status: 500 })
  }
}
