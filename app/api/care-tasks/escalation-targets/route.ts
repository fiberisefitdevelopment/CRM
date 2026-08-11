export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listEscalationTargets } from '@/src/services/careTasks/assignmentEngine'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const users = await listEscalationTargets()
    return NextResponse.json({ users })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status })
  }
}
