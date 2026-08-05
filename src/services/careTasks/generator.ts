import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { isCodOrder } from '@/src/utils/orderPayment'
import {
  isShiprocketDeliveredStatus,
  parseFlexibleDate,
} from '@/src/utils/orderTimeline'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import { assignCareExecutive } from './assignmentEngine'
import { ensureCareTaskConfigSeeded, getCareTaskConfig } from './followupPlans'
import { logCareAction } from './logger'
import { resolvePackFromOrder } from './packResolver'
import type { CareAssignee, CareTask, CareTaskPriority, CareTaskType } from './types'

const COL = 'careTasks'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function orderIdentity(order: any): { orderId: string; orderName: string } {
  const orderId = String(order?.id ?? order?.order_id ?? '')
  const orderName = String(order?.name || (orderId ? `#${orderId}` : 'Unknown'))
  return { orderId, orderName }
}

function customerFields(order: any): { customerName: string; phone: string } {
  const customerName = [
    order?.customer?.first_name || order?.shipping_address?.first_name || '',
    order?.customer?.last_name || order?.shipping_address?.last_name || '',
  ]
    .join(' ')
    .trim() || 'Customer'

  const rawPhone =
    order?.customer?.phone ||
    order?.shipping_address?.phone ||
    order?.phone ||
    order?.shiprocket_meta?.customer_phone ||
    ''

  return { customerName, phone: phoneMatchKey(rawPhone) }
}

export function addDaysIso(base: Date, days: number): string {
  const d = new Date(base.getTime())
  d.setHours(9, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * Delivery / follow-up base date.
 * MUST use parseFlexibleDate — Shiprocket sends DD-MM-YYYY and `new Date()`
 * misreads e.g. 01-08-2026 as 8 Jan instead of 1 Aug.
 */
export function deliveryDate(order: any): Date {
  const meta = order?.shiprocket_meta || {}
  const fulfillment = order?.fulfillments?.[0] || {}
  const candidates = [
    meta.delivered_date,
    meta.delivery_date,
    fulfillment.delivery_date,
    fulfillment.updated_at,
    order?.updated_at,
    order?.created_at,
  ]
  for (const c of candidates) {
    if (!c) continue
    const d = parseFlexibleDate(String(c))
    if (d) return d
  }
  return new Date()
}

export function createdDate(order: any): Date {
  const d = parseFlexibleDate(order?.created_at) || new Date(order?.created_at || Date.now())
  return isNaN(d.getTime()) ? new Date() : d
}

/** Correct due date for a follow-up task (delivery + scheduleDay). */
export function computeFollowupScheduledAt(order: any, scheduleDay: number): string {
  return addDaysIso(deliveryDate(order), scheduleDay)
}

export function makeDedupeKey(orderId: string, taskType: string, scheduleDay: number): string {
  return `${orderId}__${taskType}__d${scheduleDay}`.replace(/[\/#\[\]]/g, '_')
}

async function createTaskIfMissing(params: {
  order: any
  taskType: CareTaskType
  taskLabel: string
  scheduleDay: number
  scheduledAt: string
  priority: CareTaskPriority
  packKey: string
  packLabel: string
  assignee: CareAssignee | null
  /** Skip per-task audit log during large backfills */
  quiet?: boolean
}): Promise<CareTask | null> {
  const { orderId, orderName } = orderIdentity(params.order)
  if (!orderId) return null

  const dedupeKey = makeDedupeKey(orderId, params.taskType, params.scheduleDay)
  const ref = getDb().collection(COL).doc(dedupeKey)

  const { customerName, phone } = customerFields(params.order)
  const now = new Date().toISOString()
  const orderCreatedAt = createdDate(params.order).toISOString()

  const doc: Omit<CareTask, 'id'> = {
    dedupeKey,
    orderId,
    orderName,
    customerName,
    phone,
    paymentMethod: isCodOrder(params.order) ? 'cod' : 'prepaid',
    packKey: params.packKey,
    packLabel: params.packLabel,
    taskType: params.taskType,
    taskLabel: params.taskLabel,
    scheduleDay: params.scheduleDay,
    scheduledAt: params.scheduledAt,
    orderCreatedAt,
    priority: params.priority,
    status: 'pending',
    assignedTo: params.assignee,
    notes: [],
    lastCall: null,
    calls: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    source: 'auto',
    overdueNotifiedAt: null,
  }

  try {
    await ref.create({
      ...doc,
      createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err: any) {
    // Already exists — repair bad due dates (DD-MM misparse left Jan dates on Jul/Aug orders)
    const code = err?.code
    const msg = String(err?.message || '')
    if (code === 6 || code === 'already-exists' || /already exists/i.test(msg)) {
      try {
        const existing = await ref.get()
        const prev = existing.data() || {}
        const prevStatus = String(prev.status || '')
        if (['completed'].includes(prevStatus)) return null
        const oldTs = new Date(prev.scheduledAt || 0).getTime()
        const newTs = new Date(params.scheduledAt).getTime()
        const orderCreatedTs = new Date(orderCreatedAt).getTime()
        const clearlyWrong =
          Number.isFinite(oldTs) &&
          Number.isFinite(newTs) &&
          (Math.abs(oldTs - newTs) > 12 * 3600 * 1000 ||
            (Number.isFinite(orderCreatedTs) && oldTs < orderCreatedTs - 24 * 3600 * 1000))
        if (clearlyWrong) {
          await ref.update({
            scheduledAt: params.scheduledAt,
            orderCreatedAt,
            updatedAt: now,
            updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
      } catch (repairErr) {
        console.warn('careTasks: failed to repair scheduledAt', dedupeKey, repairErr)
      }
      return null
    }
    // One retry on transient Firestore timeouts
    if (
      code === 4 ||
      code === 'deadline-exceeded' ||
      /DEADLINE_EXCEEDED/i.test(msg)
    ) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        await ref.create({
          ...doc,
          createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        })
      } catch (retryErr: any) {
        const rCode = retryErr?.code
        const rMsg = String(retryErr?.message || '')
        if (rCode === 6 || rCode === 'already-exists' || /already exists/i.test(rMsg)) {
          return null
        }
        throw retryErr
      }
      // fall through to logging below on success
    } else {
      throw err
    }
  }

  if (!params.quiet) {
    await logCareAction({
      action: 'TASK_CREATED',
      orderId,
      orderName,
      taskId: dedupeKey,
      details: {
        taskType: params.taskType,
        scheduleDay: params.scheduleDay,
        assignedTo: params.assignee?.email || null,
      },
      status: 'success',
    })
  }

  return { id: dedupeKey, ...doc }
}

/** Mark open COD confirmation complete once the order is delivered. */
async function autoCloseCodConfirmation(order: any): Promise<void> {
  const { orderId } = orderIdentity(order)
  if (!orderId) return
  const dedupeKey = makeDedupeKey(orderId, 'cod_confirmation', -1)
  const ref = getDb().collection(COL).doc(dedupeKey)
  try {
    const snap = await ref.get()
    if (!snap.exists) return
    const status = String(snap.data()?.status || '')
    if (!['pending', 'rescheduled', 'escalated', 'unreachable'].includes(status)) return
    const now = new Date().toISOString()
    await ref.update({
      status: 'completed',
      outcome: 'Auto-closed — order delivered',
      remarks: 'COD confirmation no longer needed after delivery',
      completedAt: now,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.warn('careTasks: failed to auto-close COD confirmation', orderId, err)
  }
}

/** COD Confirmation Call — immediately after order creation (not after delivery). */
export async function ensureCodConfirmationTask(
  order: any,
  assigneeOverride?: CareAssignee | null,
): Promise<CareTask | null> {
  if (!isCodOrder(order)) return null
  if (order?.is_test_order || order?.test === true) return null
  // Confirmation is only for pre-delivery COD — skip once delivered
  if (isShiprocketDeliveredStatus(order)) return null

  const assignee = assigneeOverride === undefined ? await assignCareExecutive() : assigneeOverride
  const pack = resolvePackFromOrder(order, await getCareTaskConfig())
  return createTaskIfMissing({
    order,
    taskType: 'cod_confirmation',
    taskLabel: 'COD Confirmation Call',
    scheduleDay: -1,
    scheduledAt: createdDate(order).toISOString(),
    priority: 'high',
    packKey: pack.packKey,
    packLabel: pack.label,
    assignee,
    quiet: assigneeOverride !== undefined,
  })
}

/** After delivery: introduction + pack follow-ups. */
export async function ensureDeliveredFollowupTasks(
  order: any,
  assigneeOverride?: CareAssignee | null,
): Promise<CareTask[]> {
  if (!isCodOrder(order)) return []
  if (order?.is_test_order || order?.test === true) return []
  if (!isShiprocketDeliveredStatus(order)) return []

  await autoCloseCodConfirmation(order)

  const config = await getCareTaskConfig()
  const pack = resolvePackFromOrder(order, config)
  const created: CareTask[] = []

  let assignee: CareAssignee | null =
    assigneeOverride === undefined ? null : assigneeOverride ?? null

  if (assigneeOverride === undefined) {
    const existing = await getDb()
      .collection(COL)
      .where('orderId', '==', String(order.id))
      .limit(5)
      .get()
    for (const doc of existing.docs) {
      const a = doc.data()?.assignedTo
      if (a?.email) {
        assignee = a as CareAssignee
        break
      }
    }
    if (!assignee) assignee = await assignCareExecutive()
  }

  for (const step of pack.plan.steps) {
    const task = await createTaskIfMissing({
      order,
      taskType: step.taskType,
      taskLabel: step.taskLabel,
      scheduleDay: step.day,
      scheduledAt: computeFollowupScheduledAt(order, step.day),
      priority: step.priority || 'medium',
      packKey: pack.packKey,
      packLabel: pack.label,
      assignee,
      quiet: assigneeOverride !== undefined,
    })
    if (task) created.push(task)
  }

  return created
}

export interface CareProcessResult {
  scanned: number
  confirmationCreated: number
  followupsCreated: number
  errors: number
  assigneeEmail?: string | null
}

export interface ProcessCareOptions {
  /** Max COD orders to process (newest first). Default 150. */
  maxOrders?: number
}

/** Idempotent scan of order list — used by sync + cron + Generate. */
export async function processOrdersForCareTasks(
  orders: any[],
  opts: ProcessCareOptions = {},
): Promise<CareProcessResult> {
  await ensureCareTaskConfigSeeded()

  const maxOrders = Math.max(1, Math.min(opts.maxOrders ?? 150, 400))
  const assignee = await assignCareExecutive()
  const config = await getCareTaskConfig()

  const codOrders = orders
    .filter((o) => o && !o.is_test_order && o.test !== true && isCodOrder(o))
    .sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime()
      const tb = new Date(b.created_at || 0).getTime()
      return tb - ta
    })
    .slice(0, maxOrders)

  const result: CareProcessResult = {
    scanned: 0,
    confirmationCreated: 0,
    followupsCreated: 0,
    errors: 0,
    assigneeEmail: assignee?.email || null,
  }

  console.log(
    `careTasks: processing ${codOrders.length} COD orders → assign ${assignee?.email || 'none'}`,
  )

  for (const order of codOrders) {
    result.scanned += 1
    try {
      const pack = resolvePackFromOrder(order, config)
      const delivered = isShiprocketDeliveredStatus(order)

      // COD confirmation only before delivery
      if (!delivered) {
        const conf = await createTaskIfMissing({
          order,
          taskType: 'cod_confirmation',
          taskLabel: 'COD Confirmation Call',
          scheduleDay: -1,
          scheduledAt: createdDate(order).toISOString(),
          priority: 'high',
          packKey: pack.packKey,
          packLabel: pack.label,
          assignee,
          quiet: true,
        })
        if (conf) result.confirmationCreated += 1
      } else {
        // Auto-close any open COD confirmation — call is no longer needed
        await autoCloseCodConfirmation(order)
        for (const step of pack.plan.steps) {
          const task = await createTaskIfMissing({
            order,
            taskType: step.taskType,
            taskLabel: step.taskLabel,
            scheduleDay: step.day,
            scheduledAt: computeFollowupScheduledAt(order, step.day),
            priority: step.priority || 'medium',
            packKey: pack.packKey,
            packLabel: pack.label,
            assignee,
            quiet: true,
          })
          if (task) result.followupsCreated += 1
        }
      }
    } catch (err: any) {
      result.errors += 1
      console.error(`careTasks: failed for order ${order?.name || order?.id}:`, err?.message || err)
    }
  }

  await logCareAction({
    action: 'BATCH_PROCESS',
    details: result as unknown as Record<string, unknown>,
    status: result.errors && !result.confirmationCreated && !result.followupsCreated ? 'failure' : 'success',
  })

  return result
}

function inferCareOrderTag(
  data: Record<string, any>,
): CareTask['careOrderTag'] {
  const raw = String(data.careOrderTag || '').trim()
  if (raw === 'care_confirmed' || raw === 'care_cancelled' || raw === 'aisensy_confirmed') {
    return raw
  }
  // Recover tags when Firestore field was dropped but outcome text remains
  const outcome = String(data.outcome || '').toLowerCase()
  if (outcome.includes('cod confirmed by customer care')) return 'care_confirmed'
  if (outcome.includes('cancel requested by customer care')) return 'care_cancelled'
  return null
}

export function serializeCareTask(id: string, data: Record<string, any>): CareTask {
  return {
    id,
    dedupeKey: data.dedupeKey || id,
    orderId: String(data.orderId || ''),
    orderName: String(data.orderName || ''),
    customerName: String(data.customerName || ''),
    phone: String(data.phone || ''),
    paymentMethod: data.paymentMethod || 'unknown',
    packKey: String(data.packKey || ''),
    packLabel: data.packLabel,
    taskType: data.taskType,
    taskLabel: data.taskLabel || data.taskType,
    scheduleDay: Number(data.scheduleDay ?? 0),
    scheduledAt: data.scheduledAt || '',
    orderCreatedAt: data.orderCreatedAt || null,
    priority: data.priority || 'medium',
    status: data.status || 'pending',
    assignedTo: data.assignedTo || null,
    outcome: data.outcome,
    remarks: data.remarks,
    customerResponse: data.customerResponse,
    customerRating:
      typeof data.customerRating === 'number' ? data.customerRating : undefined,
    lastUnreachableAt: data.lastUnreachableAt || null,
    rescheduledAt: data.rescheduledAt || null,
    notes: Array.isArray(data.notes) ? data.notes : [],
    lastCall: data.lastCall || null,
    calls: Array.isArray(data.calls) ? data.calls : [],
    createdAt: data.createdAt || '',
    updatedAt: data.updatedAt,
    completedAt: data.completedAt || null,
    source: data.source || 'auto',
    overdueNotifiedAt: data.overdueNotifiedAt || null,
    companyId: data.companyId,
    careOrderTag: inferCareOrderTag(data),
  }
}
