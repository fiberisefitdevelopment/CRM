export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listCareTasks } from '@/src/services/careTasks/queries'
import {
  canAccessCareTasksApi,
  resolveCareTaskAssigneeFilter,
  requireSession,
} from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = (searchParams.get('status') || 'inbox') as any
    const kind = (searchParams.get('kind') || 'all') as any
    const search = searchParams.get('search') || undefined
    const page = Number(searchParams.get('page') || 1)
    const pageSize = Number(searchParams.get('pageSize') || 20)

    const assigneeParam = searchParams.get('assignee')
    const assigneeEmail = resolveCareTaskAssigneeFilter(session, assigneeParam)

    const result = await listCareTasks({
      status,
      kind,
      search,
      page,
      pageSize,
      assigneeEmail,
    })

    return NextResponse.json({
      tasks: result.tasks,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      kindCounts: result.kindCounts,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize) || 1),
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to list care tasks' }, { status })
  }
}
