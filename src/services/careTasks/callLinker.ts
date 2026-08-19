import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { type CallData } from '@/src/services/customerService'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import { logCareAction } from './logger'
import type { CareLinkedCall } from './types'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function toLinkedCall(call: CallData): CareLinkedCall {
  return {
    callId: String(call.callId),
    startTime: call.startTime,
    createdAt: call.createdAt,
    duration: call.duration,
    answered: call.answered,
    inbound: call.inbound,
    number: call.number,
    formattedNumber: call.formattedNumber,
    source: call.source,
    sourceDetail: call.sourceDetail,
    recType: call.recType,
    hasRecording: Boolean(call.recUrl || (call.recType && call.recType !== 'none')),
    userName: call.userName,
    userEmail: call.userEmail,
    attachedAt: new Date().toISOString(),
  }
}

async function attachCallToTask(taskId: string, linked: CareLinkedCall): Promise<boolean> {
  const ref = getDb().collection('careTasks').doc(taskId)
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const data = snap.data() || {}
    const calls: CareLinkedCall[] = Array.isArray(data.calls) ? data.calls : []
    if (calls.some((c) => c.callId === linked.callId)) return false

    const nextCalls = [linked, ...calls].slice(0, 50)
    tx.update(ref, {
      calls: nextCalls,
      lastCall: linked,
      updatedAt: new Date().toISOString(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
    return true
  })
}

/** Find open-ish tasks for a phone and attach the call to the best match. */
export async function linkCallByPhone(call: CallData): Promise<number> {
  const key = phoneMatchKey(call.number || call.formattedNumber)
  if (!key || !call.callId) return 0

  const snap = await getDb().collection('careTasks').where('phone', '==', key).limit(40).get()
  if (snap.empty) return 0

  const linked = toLinkedCall(call)
  const preferredStatuses = new Set(['pending', 'rescheduled', 'escalated', 'unreachable'])

  const docs = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .sort((a, b) => {
      const aPref = preferredStatuses.has(a.data.status) ? 0 : 1
      const bPref = preferredStatuses.has(b.data.status) ? 0 : 1
      if (aPref !== bPref) return aPref - bPref
      return String(b.data.scheduledAt || '').localeCompare(String(a.data.scheduledAt || ''))
    })

  let attached = 0
  // Attach to the most relevant active task; also mirror onto same-order siblings
  const primary = docs[0]
  if (primary && (await attachCallToTask(primary.id, linked))) {
    attached += 1
    await logCareAction({
      action: 'CALL_ATTACHED',
      taskId: primary.id,
      orderId: String(primary.data.orderId || ''),
      orderName: String(primary.data.orderName || ''),
      details: { callId: linked.callId, phone: key },
      status: 'success',
    })
  }

  const orderId = String(primary?.data.orderId || '')
  if (orderId) {
    for (const doc of docs.slice(1)) {
      if (String(doc.data.orderId) !== orderId) continue
      if (await attachCallToTask(doc.id, linked)) attached += 1
    }
  }

  return attached
}

export interface SyncCallsResult {
  fetched: number
  attached: number
  errors: number
}

/** Device call logs live in Firestore `counters` and are listed on demand. */
export async function syncSalestrailCallsToCareTasks(_hoursBack = 48): Promise<SyncCallsResult> {
  return { fetched: 0, attached: 0, errors: 0 }
}
