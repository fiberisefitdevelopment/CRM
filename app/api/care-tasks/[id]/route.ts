export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { getCareTaskById } from '@/src/services/careTasks/queries'
import { logCareAction } from '@/src/services/careTasks/logger'
import {
  canAccessCareTasksApi,
  canViewAllCareTasks,
  requireSession,
} from '@/src/services/careTasks/session'
import { isCareExecutiveRole } from '@/src/utils/accessControl'
import type { CareTaskStatus } from '@/src/services/careTasks/types'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

/** Admin + care executives share the same org-wide task pool. */
function assertCanAccessTask(session: { email: string; role: string }) {
  if (canViewAllCareTasks(session.role) || isCareExecutiveRole(session.role)) return
  if (canAccessCareTasksApi(session.role)) return
  const err = new Error('Forbidden') as Error & { status: number }
  err.status = 403
  throw err
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const params = await Promise.resolve(ctx.params)
    const task = await getCareTaskById(params.id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    assertCanAccessTask(session)
    return NextResponse.json({ task })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load task' }, { status })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const params = await Promise.resolve(ctx.params)
    const task = await getCareTaskById(params.id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    assertCanAccessTask(session)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').toLowerCase()
    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    }

    // Claim for the acting executive so ownership stays consistent
    if (
      isCareExecutiveRole(session.role) &&
      task.assignedTo?.email?.toLowerCase() !== session.email.toLowerCase()
    ) {
      patch.assignedTo = {
        userId: session.email.split('@')[0] || 'executive',
        email: session.email.toLowerCase(),
        name: session.email.split('@')[0] || 'Executive',
      }
    }

    if (action === 'confirm_cod' || action === 'cancel_cod') {
      // Display-only tag on Orders / Order Status — does NOT cancel or edit Shopify
      const { storeCareOrderTag } = require('@/src/services/careOrderTagStore')
      const kind = action === 'confirm_cod' ? 'care_confirmed' : 'care_cancelled'
      const tag = storeCareOrderTag({
        orderId: task.orderId,
        orderName: task.orderName,
        kind,
        byEmail: session.email,
        byName: session.email.split('@')[0] || 'Care',
      })
      patch.status = 'completed' as CareTaskStatus
      patch.outcome =
        action === 'confirm_cod'
          ? 'COD confirmed by customer care executive'
          : 'Cancel requested by customer care executive (tag only)'
      patch.remarks =
        action === 'confirm_cod'
          ? 'Order confirmed — tag set for Orders / Order Status'
          : 'Customer wants to cancel — tag set for ops (order not cancelled in Shopify)'
      patch.customerResponse =
        action === 'confirm_cod' ? 'Customer confirmed COD order' : 'Customer requested cancellation'
      patch.completedAt = new Date().toISOString()
      patch.careOrderTag = tag.kind
    } else if (action === 'complete' || body.status === 'completed') {
      if (!body.outcome || !body.remarks || !body.customerResponse) {
        return NextResponse.json(
          { error: 'Call Outcome, Remarks, and Customer Response are required to complete a task.' },
          { status: 400 },
        )
      }
      patch.status = 'completed' as CareTaskStatus
      patch.outcome = String(body.outcome)
      patch.remarks = String(body.remarks)
      patch.customerResponse = String(body.customerResponse)
      patch.completedAt = new Date().toISOString()
    } else if (action === 'unreachable' || body.status === 'unreachable') {
      patch.status = 'unreachable'
      if (body.remarks) patch.remarks = String(body.remarks)
      if (body.outcome) patch.outcome = String(body.outcome)
    } else if (action === 'reschedule' || body.status === 'rescheduled') {
      if (!body.scheduledAt) {
        return NextResponse.json({ error: 'scheduledAt is required to reschedule.' }, { status: 400 })
      }
      patch.status = 'rescheduled'
      patch.scheduledAt = String(body.scheduledAt)
      if (body.remarks) patch.remarks = String(body.remarks)
    } else if (action === 'escalate' || body.status === 'escalated') {
      patch.status = 'escalated'
      if (body.remarks) patch.remarks = String(body.remarks)
      if (body.outcome) patch.outcome = String(body.outcome)
    } else if (body.status) {
      patch.status = body.status
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    await getDb().collection('careTasks').doc(params.id).update(patch)
    await logCareAction({
      action: `TASK_${String(patch.status || action).toUpperCase()}`,
      taskId: params.id,
      orderId: task.orderId,
      orderName: task.orderName,
      details: { by: session.email, ...patch },
      status: 'success',
    })

    const updated = await getCareTaskById(params.id)
    return NextResponse.json({ task: updated })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to update task' }, { status })
  }
}
