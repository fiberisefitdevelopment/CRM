export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAgvaUser, authErrorResponse } from '@/src/services/auth'
import { getActionLogsPaginated } from '@/src/services/auditLogService'

const AGVA_SUFFIX = '@agvahealthtech.com'

export async function GET(req: NextRequest) {
  try {
    await requireAgvaUser(req)

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') || '25', 10)))
    const search = searchParams.get('search') || undefined
    const module = searchParams.get('module') || undefined
    const status = searchParams.get('status') || undefined

    const { logs, total } = await getActionLogsPaginated({
      page,
      perPage,
      search,
      module,
      status,
      emailDomainSuffix: AGVA_SUFFIX,
    })

    const totalPages = Math.ceil(total / perPage) || 1

    return NextResponse.json({
      success: true,
      logs,
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
    console.error('Agva audit logs error:', error)
    return NextResponse.json({ error: 'Failed to load audit logs.' }, { status: 500 })
  }
}
