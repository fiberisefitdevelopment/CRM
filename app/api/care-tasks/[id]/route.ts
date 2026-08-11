export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { getCareTaskById, invalidateCareTasksCache } from '@/src/services/careTasks/queries'
import { logCareAction } from '@/src/services/careTasks/logger'
import {
  assertCanAccessCareTask,
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'
import {
  CALL_AFTER_MAX_MS,
  UNREACHABLE_RETRY_MS,
  requiresCustomerRating,
  type CareTaskStatus,
} from '@/src/services/careTasks/types'
import { careActorLabel } from '@/src/services/careTasks/actorLabel'
import {
  careExecutiveAssignee,
  normalizeCareExecutiveEmail,
} from '@/src/services/careTasks/executiveConfig'
import { pinCareExecutiveOnTask } from '@/src/services/careTasks/assignmentEngine'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const params = await ctx.params
    const task = await getCareTaskById(params.id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    assertCanAccessCareTask(session, task)
    return NextResponse.json({ task })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load task' }, { status })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const params = await ctx.params
    const task = await getCareTaskById(params.id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    assertCanAccessCareTask(session, task)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').toLowerCase()
    const nowIso = new Date().toISOString()
    const patch: Record<string, unknown> = {
      updatedAt: nowIso,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (action === 'confirm_cod' || action === 'cancel_cod') {
      // Display-only tag on Orders / Order Status — does NOT cancel or edit Shopify
      const { storeCareOrderTag } = require('@/src/services/careOrderTagStore')
      const kind = action === 'confirm_cod' ? 'care_confirmed' : 'care_cancelled'
      const actor = careActorLabel(session)
      const tag = storeCareOrderTag({
        orderId: task.orderId,
        orderName: task.orderName,
        kind,
        byEmail: session.email,
        byName: actor,
      })
      patch.status = 'completed' as CareTaskStatus
      patch.outcome =
        action === 'confirm_cod'
          ? `Confirmed by ${actor}`
          : `Cancel requested by ${actor} (tag only)`
      patch.remarks =
        action === 'confirm_cod'
          ? 'Order confirmed — tag set for Orders / Order Status'
          : 'Customer wants to cancel — tag set for ops (order not cancelled in Shopify)'
      patch.customerResponse =
        action === 'confirm_cod' ? 'Customer confirmed COD order' : 'Customer requested cancellation'
      patch.completedAt = nowIso
      patch.careOrderTag = tag.kind
      if (action === 'confirm_cod') {
        patch.priority = 'medium'
      }
      const actorEmail = normalizeCareExecutiveEmail(session.email)
      if (actorEmail) {
        const assignee = careExecutiveAssignee(actorEmail, session.id, actor)
        patch.assignedTo = assignee
        await pinCareExecutiveOnTask(task, assignee)
      }
    } else if (action === 'complete' || body.status === 'completed') {
      if (!body.outcome || !body.remarks || !body.customerResponse) {
        return NextResponse.json(
          { error: 'Call Outcome, Remarks, and Customer Response are required to complete a task.' },
          { status: 400 },
        )
      }
      if (requiresCustomerRating(task)) {
        const rating = Number(body.customerRating)
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          return NextResponse.json(
            { error: 'Customer rating (1–5 stars) is required for this call type.' },
            { status: 400 },
          )
        }
        patch.customerRating = rating
      }
      patch.status = 'completed' as CareTaskStatus
      patch.outcome = String(body.outcome)
      patch.remarks = String(body.remarks)
      patch.customerResponse = String(body.customerResponse)
      patch.completedAt = nowIso
    } else if (action === 'unreachable' || body.status === 'unreachable') {
      // Auto-bring back in 1 hour as a rescheduled reminder
      const retryAt = new Date(Date.now() + UNREACHABLE_RETRY_MS).toISOString()
      patch.status = 'rescheduled' as CareTaskStatus
      patch.scheduledAt = retryAt
      patch.lastUnreachableAt = nowIso
      patch.rescheduledAt = nowIso
      patch.remarks = body.remarks ? String(body.remarks) : 'Customer unreachable'
      if (body.outcome) patch.outcome = String(body.outcome)
    } else if (action === 'call_after') {
      if (!body.scheduledAt) {
        return NextResponse.json(
          { error: 'Pick a call-after date & time (within 3 days).' },
          { status: 400 },
        )
      }
      const when = new Date(String(body.scheduledAt)).getTime()
      if (Number.isNaN(when)) {
        return NextResponse.json({ error: 'Invalid call-after date.' }, { status: 400 })
      }
      const now = Date.now()
      if (when < now - 60_000) {
        return NextResponse.json({ error: 'Call-after time must be in the future.' }, { status: 400 })
      }
      if (when > now + CALL_AFTER_MAX_MS) {
        return NextResponse.json(
          { error: 'Call After can be at most 3 days from now.' },
          { status: 400 },
        )
      }
      patch.status = 'rescheduled' as CareTaskStatus
      patch.scheduledAt = new Date(when).toISOString()
      patch.rescheduledAt = nowIso
      if (body.remarks) patch.remarks = String(body.remarks)
    } else if (action === 'reschedule' || body.status === 'rescheduled') {
      if (!body.scheduledAt) {
        return NextResponse.json({ error: 'scheduledAt is required to reschedule.' }, { status: 400 })
      }
      patch.status = 'rescheduled'
      patch.scheduledAt = String(body.scheduledAt)
      patch.rescheduledAt = nowIso
      if (body.remarks) patch.remarks = String(body.remarks)
    } else if (action === 'not_interested') {
      const reason = String(body.remarks || '').trim()
      if (!reason) {
        return NextResponse.json({ error: 'Reason is required.' }, { status: 400 })
      }
      patch.status = 'not_interested' as CareTaskStatus
      patch.outcome = 'Not interested'
      patch.remarks = reason
      patch.customerResponse = body.customerResponse
        ? String(body.customerResponse)
        : 'Customer not interested'
      patch.completedAt = nowIso
    } else if (action === 'escalate' || body.status === 'escalated') {
      const reason = String(body.remarks || '').trim()
      if (!reason) {
        return NextResponse.json(
          { error: 'Escalate reason is required.' },
          { status: 400 },
        )
      }
      const rawTarget = body.escalatedTo
      const targetEmail = String(
        rawTarget && typeof rawTarget === 'object' ? rawTarget.email : body.escalatedToEmail || '',
      )
        .toLowerCase()
        .trim()
      if (!targetEmail) {
        return NextResponse.json(
          { error: 'Select who to escalate this task to.' },
          { status: 400 },
        )
      }
      const escalatedTo = {
        userId: String(
          rawTarget && typeof rawTarget === 'object' && rawTarget.userId
            ? rawTarget.userId
            : targetEmail.split('@')[0],
        ),
        email: targetEmail,
        name: String(
          rawTarget && typeof rawTarget === 'object' && rawTarget.name
            ? rawTarget.name
            : targetEmail.split('@')[0] || 'User',
        ),
      }
      patch.status = 'escalated'
      patch.remarks = reason
      patch.escalatedTo = escalatedTo
      patch.assignedTo = escalatedTo
      if (body.outcome) patch.outcome = String(body.outcome)
    } else if (body.status) {
      patch.status = body.status
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    await getDb().collection('careTasks').doc(params.id).update(patch)
    invalidateCareTasksCache()

    const logAction =
      action === 'unreachable'
        ? 'TASK_UNREACHABLE'
        : action === 'call_after'
          ? 'TASK_CALL_AFTER'
          : action === 'not_interested'
            ? 'TASK_NOT_INTERESTED'
            : `TASK_${String(patch.status || action).toUpperCase()}`

    await logCareAction({
      action: logAction,
      taskId: params.id,
      orderId: task.orderId,
      orderName: task.orderName,
      details: { by: session.email, action, ...patch },
      status: 'success',
    })

    const updated = await getCareTaskById(params.id)
    return NextResponse.json({ task: updated })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to update task' }, { status })
  }
}
