export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { summarizeCareTasks } from '@/src/services/careTasks/queries'
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

    const assigneeParam = new URL(req.url).searchParams.get('assignee')
    const assignee = resolveCareTaskAssigneeFilter(session, assigneeParam)

    const summary = await summarizeCareTasks(assignee)
    return NextResponse.json({ summary })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load summary' }, { status })
  }
}
