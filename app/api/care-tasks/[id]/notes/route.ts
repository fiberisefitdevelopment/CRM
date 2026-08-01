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
import type { CareTaskNote } from '@/src/services/careTasks/types'
import crypto from 'crypto'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

export async function POST(
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

    // Same org-wide access as the task list (admin + care executives)
    if (!canViewAllCareTasks(session.role) && !canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const text = String(body.text || body.note || '').trim()
    if (!text) {
      return NextResponse.json({ error: 'Note text is required' }, { status: 400 })
    }

    const note: CareTaskNote = {
      id: crypto.randomUUID(),
      text,
      authorEmail: session.email,
      authorName: session.email.split('@')[0] || session.email,
      createdAt: new Date().toISOString(),
    }

    const notes = [note, ...(task.notes || [])]
    await getDb().collection('careTasks').doc(params.id).update({
      notes,
      updatedAt: new Date().toISOString(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })

    await logCareAction({
      action: 'NOTE_ADDED',
      taskId: params.id,
      orderId: task.orderId,
      orderName: task.orderName,
      details: { by: session.email },
      status: 'success',
    })

    const updated = await getCareTaskById(params.id)
    return NextResponse.json({ task: updated, note })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to add note' }, { status })
  }
}
