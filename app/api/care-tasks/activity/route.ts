export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'
import { listCareTaskLogsForOrder } from '@/src/services/careTasks/logger'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const orderId = String(searchParams.get('orderId') || '').trim()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const taskIds = String(searchParams.get('taskIds') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const logs = await listCareTaskLogsForOrder({ orderId, taskIds })
    return NextResponse.json({ logs })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error?.message || 'Failed to load activity' },
      { status },
    )
  }
}
