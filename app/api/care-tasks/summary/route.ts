export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { summarizeCareTasks } from '@/src/services/careTasks/queries'
import {
  canAccessCareTasksApi,
  canViewAllCareTasks,
  requireSession,
} from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Same org-wide totals for admin and executives (optional admin assignee filter).
    const isAdmin = canViewAllCareTasks(session.role)
    const assigneeParam = new URL(req.url).searchParams.get('assignee')
    const assignee = isAdmin && assigneeParam ? assigneeParam.toLowerCase() : undefined

    const summary = await summarizeCareTasks(assignee)
    return NextResponse.json({ summary })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load summary' }, { status })
  }
}
