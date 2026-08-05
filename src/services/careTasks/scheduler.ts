import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { getCachedOrders } from '@/src/services/ordersCache'
import { syncSalestrailCallsToCareTasks } from './callLinker'
import { processOrdersForCareTasks } from './generator'
import { getCareTaskConfig } from './followupPlans'
import { logCareAction } from './logger'
import { invalidateCareTasksCache } from './taskCache'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

export interface CareSchedulerResult {
  ordersProcessed: Awaited<ReturnType<typeof processOrdersForCareTasks>>
  callsSynced: Awaited<ReturnType<typeof syncSalestrailCallsToCareTasks>>
  overdueMarked: number
  promotedReschedules: number
}

/** Mark pending tasks past schedule + SLA as needing attention (status stays pending; flag for UI). */
async function sweepOverdue(): Promise<number> {
  const config = await getCareTaskConfig()
  const slaMs = (config.slaHours || 24) * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - slaMs).toISOString()

  const snap = await getDb()
    .collection('careTasks')
    .where('status', '==', 'pending')
    .where('scheduledAt', '<', cutoff)
    .limit(200)
    .get()

  let marked = 0
  const batch = getDb().batch()
  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.overdueNotifiedAt) continue
    batch.update(doc.ref, {
      overdueNotifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
    marked += 1
  }
  if (marked > 0) await batch.commit()
  return marked
}

/** Call After / unreachable retries whose time has arrived → back to To do. */
async function promoteDueReschedules(): Promise<number> {
  const snap = await getDb()
    .collection('careTasks')
    .where('status', '==', 'rescheduled')
    .limit(500)
    .get()

  if (snap.empty) return 0

  const now = Date.now()
  const due = snap.docs.filter((d) => {
    const ts = new Date(String(d.data().scheduledAt || '')).getTime()
    return Number.isFinite(ts) && ts <= now
  })
  if (!due.length) return 0

  const batch = getDb().batch()
  const updatedAt = new Date().toISOString()
  for (const doc of due.slice(0, 200)) {
    batch.update(doc.ref, {
      status: 'pending',
      updatedAt,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  return Math.min(due.length, 200)
}

export async function runCareTaskScheduler(): Promise<CareSchedulerResult> {
  const orders = getCachedOrders() || []
  const ordersProcessed = await processOrdersForCareTasks(orders)
  const callsSynced = await syncSalestrailCallsToCareTasks(48)
  const promotedReschedules = await promoteDueReschedules()
  const overdueMarked = await sweepOverdue()
  invalidateCareTasksCache()

  await logCareAction({
    action: 'SCHEDULER_RUN',
    details: {
      scanned: ordersProcessed.scanned,
      confirmationCreated: ordersProcessed.confirmationCreated,
      followupsCreated: ordersProcessed.followupsCreated,
      callsAttached: callsSynced.attached,
      promotedReschedules,
      overdueMarked,
    },
    status: 'success',
  })

  return { ordersProcessed, callsSynced, overdueMarked, promotedReschedules }
}
