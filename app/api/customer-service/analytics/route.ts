import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  buildCallAnalytics,
  dateInputToIso,
  defaultDateRange,
  getCalls,
} from '@/src/services/customerService'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const defaults = defaultDateRange(30)
    const from = dateInputToIso(sp.get('from') || defaults.from, false)
    const to = dateInputToIso(sp.get('to') || defaults.to, true)

    const calls = await getCalls({ from, to })
    const analytics = buildCallAnalytics(calls)

    return NextResponse.json(analytics)
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service analytics GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to load analytics.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
