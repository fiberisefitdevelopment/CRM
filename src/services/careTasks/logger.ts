import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

export type CareTaskLogEntry = {
  id: string
  action: string
  orderId: string | null
  orderName: string | null
  taskId: string | null
  details: Record<string, unknown>
  status: string
  createdAt: string | null
}

function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (
    typeof value === 'object' &&
    value &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return (value as admin.firestore.Timestamp).toDate().toISOString()
    } catch {
      return null
    }
  }
  return null
}

export async function logCareAction(params: {
  action: string
  orderId?: string
  orderName?: string
  taskId?: string
  details?: Record<string, unknown>
  status?: 'success' | 'failure' | 'info'
}): Promise<void> {
  try {
    await getDb().collection('careTaskLogs').add({
      action: params.action,
      orderId: params.orderId || null,
      orderName: params.orderName || null,
      taskId: params.taskId || null,
      details: params.details || {},
      status: params.status || 'info',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('careTasks: failed to write log', err)
  }
}

/** Recent care actions for an order (and optionally matching task ids). */
export async function listCareTaskLogsForOrder(params: {
  orderId: string
  taskIds?: string[]
  limit?: number
}): Promise<CareTaskLogEntry[]> {
  const orderId = String(params.orderId || '').trim()
  if (!orderId) return []
  const limit = Math.min(Math.max(params.limit || 150, 1), 300)
  const byId = new Map<string, CareTaskLogEntry>()

  const pushDocs = (docs: Array<{ id: string; data: () => Record<string, any> }>) => {
    for (const doc of docs) {
      const data = doc.data() || {}
      byId.set(doc.id, {
        id: doc.id,
        action: String(data.action || ''),
        orderId: data.orderId != null ? String(data.orderId) : null,
        orderName: data.orderName != null ? String(data.orderName) : null,
        taskId: data.taskId != null ? String(data.taskId) : null,
        details:
          data.details && typeof data.details === 'object'
            ? (data.details as Record<string, unknown>)
            : {},
        status: String(data.status || 'info'),
        createdAt: tsToIso(data.createdAt),
      })
    }
  }

  try {
    const byOrder = await getDb()
      .collection('careTaskLogs')
      .where('orderId', '==', orderId)
      .limit(limit)
      .get()
    pushDocs(byOrder.docs)
  } catch (err) {
    console.warn('careTasks: failed to list logs by orderId', err)
  }

  const taskIds = (params.taskIds || []).map(String).filter(Boolean).slice(0, 30)
  if (taskIds.length) {
    try {
      const byTask = await getDb()
        .collection('careTaskLogs')
        .where('taskId', 'in', taskIds)
        .limit(limit)
        .get()
      pushDocs(byTask.docs)
    } catch (err) {
      console.warn('careTasks: failed to list logs by taskId', err)
    }
  }

  return [...byId.values()].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
}
