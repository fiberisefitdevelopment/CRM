export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { syncSalestrailCallsToCareTasks } from '@/src/services/careTasks/callLinker'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'

export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const hoursBack = Number(body?.hoursBack || 48)
    const result = await syncSalestrailCallsToCareTasks(hoursBack)
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status })
  }
}
