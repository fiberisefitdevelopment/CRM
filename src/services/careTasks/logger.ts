import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
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
