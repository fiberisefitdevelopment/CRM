import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  dateInputToIso,
  defaultDateRange,
  getIntegrationLogs,
  paginateCalls,
} from '@/src/services/customerService'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const defaults = defaultDateRange(30)
    const from = dateInputToIso(sp.get('from') || defaults.from, false)
    const to = dateInputToIso(sp.get('to') || defaults.to, true)
    const page = Number(sp.get('page') || 1)
    const pageSize = Number(sp.get('pageSize') || 25)
    const search = (sp.get('search') || '').trim().toLowerCase()
    const status = (sp.get('status') || '').trim().toUpperCase()
    const user = (sp.get('user') || '').trim().toLowerCase()

    const logs = await getIntegrationLogs(from, to)
    const filtered = logs.filter((log) => {
      if (status && log.integrationLogStatus.toUpperCase() !== status) return false
      if (
        user &&
        !`${log.userName} ${log.userEmail} ${log.userId}`.toLowerCase().includes(user)
      ) {
        return false
      }
      if (search) {
        const blob = [
          log.callId,
          log.callNumber,
          log.callFormatted,
          log.userName,
          log.userEmail,
          log.integrationLogStatus,
          log.integrationLogErrorMessage,
        ]
          .join(' ')
          .toLowerCase()
        if (!blob.includes(search)) return false
      }
      return true
    })

    filtered.sort((a, b) =>
      String(b.callStartTime || b.integrationLogCreated).localeCompare(
        String(a.callStartTime || a.integrationLogCreated),
      ),
    )

    const pageResult = paginateCalls(filtered, page, pageSize)

    return NextResponse.json({
      logs: pageResult.items,
      total: pageResult.total,
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      totalPages: pageResult.totalPages,
    })
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service integration GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch integration logs.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
