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
    const kindRaw = searchParams.get('kind') || 'all'
    const kind = (kindRaw === 'day_28' ? 'day_23' : kindRaw) as any
    const search = searchParams.get('search') || undefined
    const page = Number(searchParams.get('page') || 1)
    const pageSize = Number(searchParams.get('pageSize') || 20)
    const sort = (searchParams.get('sort') || undefined) as any
    const deliveredOnly =
      searchParams.get('deliveredOnly') === '1' ||
      searchParams.get('deliveredOnly') === 'true'
    const dayRaw = (searchParams.get('day') || 'all').toLowerCase()
    const dayNormalized = dayRaw === '28' ? '23' : dayRaw
    const day = (['all', '5', '23', '90', 'manual'].includes(dayNormalized)
      ? dayNormalized
      : 'all') as 'all' | '5' | '23' | '90' | 'manual'
    const packRaw = (searchParams.get('pack') || 'all').toLowerCase()
    const pack = (['all', '7', '30', '90'].includes(packRaw)
      ? packRaw
      : 'all') as 'all' | '7' | '30' | '90'
    const groupBy = searchParams.get('groupBy') === 'order' ? 'order' : 'task'

    const assigneeParam = searchParams.get('assignee')
    const assigneeEmail = resolveCareTaskAssigneeFilter(session, assigneeParam)

    const result = await listCareTasks({
      status,
      kind,
      search,
      page,
      pageSize,
      assigneeEmail,
      sort,
      deliveredOnly,
      day,
      pack,
      groupBy,
    })

    return NextResponse.json({
      tasks: result.tasks,
      groups: result.groups || [],
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
