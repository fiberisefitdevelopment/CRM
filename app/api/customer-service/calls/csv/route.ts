import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  dateInputToIso,
  defaultDateRange,
  exportCallsCsv,
  filterCalls,
  getCalls,
} from '@/src/services/customerService'

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join(
    '\n',
  )
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const defaults = defaultDateRange(30)
    const from = dateInputToIso(sp.get('from') || defaults.from, false)
    const to = dateInputToIso(sp.get('to') || defaults.to, true)
    const byCreated = sp.get('byCreated') === 'true'
    const filtered = sp.get('filtered') === 'true'

    if (!filtered) {
      const csv = await exportCallsCsv({ from, to, byCreated })
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="calls-export.csv"`,
        },
      })
    }

    const calls = await getCalls({ from, to, byCreated })
    const filteredCalls = filterCalls(calls, {
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

    const rows = filteredCalls.map((c) => ({
      callId: c.callId,
      number: c.number,
      formattedNumber: c.formattedNumber,
      phonebookName: c.phonebookName,
      userName: c.userName,
      userEmail: c.userEmail,
      userPhone: c.userPhone,
      startTime: c.startTime,
      createdAt: c.createdAt,
      duration: c.duration,
      answered: c.answered,
      inbound: c.inbound,
      integrated: c.integrated,
      source: c.source,
      sourceDetail: c.sourceDetail,
      recUrl: c.recUrl,
    }))

    const csv = toCsv(rows)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="calls-filtered-export.csv"`,
      },
    })
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service CSV export failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to export CSV.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
