import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  dateInputToIso,
  defaultDateRange,
  filterCalls,
  getCalls,
  paginateCalls,
  sortCalls,
  summarizeCalls,
} from '@/src/services/customerService'
import { enrichCallsWithOrders } from '@/src/services/customerService/enrichCallsWithOrders'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const defaults = defaultDateRange(30)

    const fromRaw = sp.get('from') || defaults.from
    const toRaw = sp.get('to') || defaults.to
    const from = dateInputToIso(fromRaw, false)
    const to = dateInputToIso(toRaw, true)
    const byCreated = sp.get('byCreated') === 'true'

    const page = Number(sp.get('page') || 1)
    const pageSize = Number(sp.get('pageSize') || 25)
    const sortBy = sp.get('sortBy') || 'startTime'
    const sortDir = (sp.get('sortDir') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
    const includeSummary = sp.get('includeSummary') === 'true'

    const calls = await getCalls({ from, to, byCreated })
    const filtered = filterCalls(calls, {
      search: sp.get('search') || undefined,
      user: sp.get('user') || undefined,
      phone: sp.get('phone') || undefined,
      answered: (sp.get('answered') as any) || 'all',
      direction: (sp.get('direction') as any) || 'all',
      integrated: (sp.get('integrated') as any) || 'all',
      source: sp.get('source') || undefined,
      sourceDetail: sp.get('sourceDetail') || undefined,
      hasRecording: sp.get('hasRecording') === 'true',
    })

    const sorted = sortCalls(filtered, sortBy, sortDir)
    const pageResult = paginateCalls(sorted, page, pageSize)
    const enriched = await enrichCallsWithOrders(pageResult.items)

    return NextResponse.json({
      calls: enriched,
      total: pageResult.total,
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      totalPages: pageResult.totalPages,
      summary: includeSummary ? summarizeCalls(filtered) : undefined,
    })
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service calls GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch calls.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
