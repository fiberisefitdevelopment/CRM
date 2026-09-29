export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAgvaUser, authErrorResponse } from '@/src/services/auth'
import {
  listDdHealthcareCalls,
  type AgvaCallTypeFilter,
  type AgvaDateRangeFilter,
} from '@/src/services/agva/ddHealthcare'
import { logAction } from '@/src/services/auditLogService'

const CALL_TYPES: AgvaCallTypeFilter[] = ['all', 'service', 'sales_enquiry', 'spam']
const DATE_RANGES: AgvaDateRangeFilter[] = ['all', 'today', '7d', '30d', 'custom']

function parseCallType(raw: string | null): AgvaCallTypeFilter {
  const v = (raw || 'all').toLowerCase() as AgvaCallTypeFilter
  return CALL_TYPES.includes(v) ? v : 'all'
}

function parseDateRange(raw: string | null): AgvaDateRangeFilter {
  const v = (raw || 'all').toLowerCase() as AgvaDateRangeFilter
  return DATE_RANGES.includes(v) ? v : 'all'
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAgvaUser(req)
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') || '25', 10)))
    const search = searchParams.get('search')?.trim() || undefined
    const callType = parseCallType(searchParams.get('call_type'))
    const location = searchParams.get('location')?.trim() || undefined
    const dateRange = parseDateRange(searchParams.get('date_range'))
    const dateFrom = searchParams.get('date_from')?.trim() || undefined
    const dateTo = searchParams.get('date_to')?.trim() || undefined

    const { calls, total, facets } = await listDdHealthcareCalls({
      page,
      perPage,
      search,
      callType,
      location,
      dateRange,
      dateFrom,
      dateTo,
    })
    const totalPages = Math.ceil(total / perPage) || 1

    void logAction({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      actionType: 'AGVA_VIEW_DD_CALLS',
      description: `${user.email} viewed D&D Healthcare calls (page ${page})`,
      module: 'agva',
      status: 'success',
      details: {
        page,
        perPage,
        search: search || null,
        callType,
        location: location || null,
        dateRange,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        resultCount: calls.length,
        total,
      },
      req,
    })

    return NextResponse.json({
      success: true,
      calls,
      facets,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: totalPages,
      },
    })
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error.status === 401 || error.status === 403)
    ) {
      return authErrorResponse(error)
    }
    console.error('Agva D&D calls error:', error)
    return NextResponse.json({ error: 'Failed to load healthcare calls.' }, { status: 500 })
  }
}
