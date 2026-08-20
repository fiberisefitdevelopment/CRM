import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  buildCallAnalytics,
  dateInputToIso,
  defaultDateRange,
  getCalls,
  sortCalls,
  summarizeCalls,
} from '@/src/services/customerService'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const defaults = defaultDateRange(30)
    const from = dateInputToIso(sp.get('from') || defaults.from, false)
    const to = dateInputToIso(sp.get('to') || defaults.to, true)

    const calls = await getCalls({ from, to })
    const summary = summarizeCalls(calls)
    const analytics = buildCallAnalytics(calls)
    const recentCalls = sortCalls(calls, 'startTime', 'desc').slice(0, 20)

    return NextResponse.json({
      summary,
      recentCalls,
      kpis: analytics.kpis,
      charts: {
        callsPerDay: analytics.callsPerDay,
        answeredVsMissed: analytics.answeredVsMissed,
        inboundVsOutbound: analytics.inboundVsOutbound,
        averageDurationTrend: analytics.averageDurationTrend,
        topUsers: analytics.topUsers,
        hourlyDistribution: analytics.hourlyDistribution,
        durationHistogram: analytics.durationHistogram,
      },
    })
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service dashboard GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to load dashboard.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
