export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  listActiveCareExecutives,
  reassignCareExecutiveForOrder,
} from '@/src/services/careTasks/assignmentEngine'
import { careExecutiveDisplayName } from '@/src/services/careTasks/executiveConfig'
import { canViewAllCareTasks, requireSession } from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canViewAllCareTasks(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const executives = await listActiveCareExecutives()
    return NextResponse.json({
      executives: executives.map((e) => ({
        userId: e.userId,
        email: e.email,
        name: careExecutiveDisplayName(e.email, e.name),
      })),
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to list care executives' },
      { status },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canViewAllCareTasks(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const orderId = String(body?.orderId || '').trim()
    const email = String(body?.email || '').trim()
    if (!orderId || !email) {
      return NextResponse.json({ error: 'orderId and email are required' }, { status: 400 })
    }

    const { assignee, tasksUpdated } = await reassignCareExecutiveForOrder({
      orderId,
      orderName: body?.orderName || null,
      email,
      phone: body?.phone || null,
    })

    return NextResponse.json({
      success: true,
      tasksUpdated,
      assignment: {
        orderId,
        orderName: body?.orderName || null,
        email: assignee.email,
        name: assignee.name,
        label: careExecutiveDisplayName(assignee.email, assignee.name),
        updatedAt: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to assign care executive' },
      { status },
    )
  }
}
