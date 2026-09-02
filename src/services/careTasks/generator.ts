import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { isCodOrder } from '@/src/utils/orderPayment'
import {
  isShiprocketDeliveredStatus,
  parseFlexibleDate,
} from '@/src/utils/orderTimeline'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import {
  assignCareExecutiveForOrder,
  persistOrderAssignment,
} from './assignmentEngine'
import { isCareConfirmedOutcome, isCareCancelledOutcome } from './actorLabel'
import { invalidateCareTasksCache, upsertCareTaskInCache } from './taskCache'
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

  // Transformation upsell moved D28 → D23: update legacy docs instead of creating a second task
  if (params.taskType === 'upsell' && params.scheduleDay === 23) {
    const legacyKey = makeDedupeKey(orderId, 'upsell', 28)
    const legacyRef = getDb().collection(COL).doc(legacyKey)
    const legacySnap = await legacyRef.get()
    if (legacySnap.exists) {
      const prev = legacySnap.data() || {}
      const now = new Date().toISOString()
      const prevStatus = String(prev.status || '')
      const intentionallyRescheduled =
        prevStatus === 'rescheduled' ||
        Boolean(prev.lastUnreachableAt) ||
        Boolean(prev.rescheduledAt)
      const patch: Record<string, unknown> = {
        scheduleDay: 23,
        taskLabel: String(prev.taskLabel || params.taskLabel).replace(/Day\s*28\b/gi, 'Day 23'),
        updatedAt: now,
        updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (!intentionallyRescheduled && !['completed', 'not_interested'].includes(prevStatus)) {
        patch.scheduledAt = params.scheduledAt
      }
      try {
        await legacyRef.update(patch)
      } catch (migrateErr) {
        console.warn('careTasks: failed to migrate D28→D23 upsell', legacyKey, migrateErr)
      }
      return null
    }
  }

  const dedupeKey = makeDedupeKey(orderId, params.taskType, params.scheduleDay)
  const ref = getDb().collection(COL).doc(dedupeKey)

  // Bulk/quiet path: check existence first (avoids expensive create→already-exists round trips)
  if (params.quiet) {
    try {
      const existing = await ref.get()
      if (existing.exists) {
        const prev = existing.data() || {}
        const prevStatus = String(prev.status || '')
        const prevTag = String(prev.careOrderTag || '').trim()
        if (['completed', 'not_interested'].includes(prevStatus)) return null
        if (prevTag === 'care_confirmed' || prevTag === 'care_cancelled') return null
        const orderCreatedAt = createdDate(params.order).toISOString()
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
            updatedAt: new Date().toISOString(),
            updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
        return null
      }
    } catch (precheckErr) {
      console.warn('careTasks: quiet precheck failed', dedupeKey, precheckErr)
    }
  }

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
        const prevTag = String(prev.careOrderTag || '').trim()
        if (['completed', 'not_interested'].includes(prevStatus)) return null
        if (prevTag === 'care_confirmed' || prevTag === 'care_cancelled') return null
        const oldTs = new Date(prev.scheduledAt || 0).getTime()
        const newTs = new Date(params.scheduledAt).getTime()
        const orderCreatedTs = new Date(orderCreatedAt).getTime()
        const clearlyWrong =
          Number.isFinite(oldTs) &&
          Number.isFinite(newTs) &&
          (Math.abs(oldTs - newTs) > 12 * 3600 * 1000 ||
            (Number.isFinite(orderCreatedTs) && oldTs < orderCreatedTs - 24 * 3600 * 1000))
        const patch: Record<string, unknown> = {}
        if (clearlyWrong) {
          patch.scheduledAt = params.scheduledAt
          patch.orderCreatedAt = orderCreatedAt
        }
        // Never steal an open task from its current executive during sync/generate.
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = now
          patch.updatedAtTs = admin.firestore.FieldValue.serverTimestamp()
          await ref.update(patch)
        }
      } catch (repairErr) {
        console.warn('careTasks: failed to repair existing task', dedupeKey, repairErr)
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

  const created = { id: dedupeKey, ...doc }
  try {
    upsertCareTaskInCache(created)
  } catch {
    // cache miss is non-fatal
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

  return created
}

/** Manual upsell from Delivered Orders page — one open task per order. */
export const MANUAL_UPSELL_SCHEDULE_DAY = -2

export function makeManualUpsellDedupeKey(orderId: string): string {
  return `${String(orderId)}__upsell__manual`.replace(/[\/#\[\]]/g, '_')
}

export function isOpenCareTaskStatus(status?: string | null): boolean {
  return ['pending', 'rescheduled', 'escalated', 'unreachable'].includes(String(status || ''))
}

/**
 * Create a manual Upsell Call for a delivered order.
 * Dedupe key: `{orderId}__upsell__manual`. Does not reopen completed / not_interested.
 */
export async function createManualUpsellTask(
  order: any,
): Promise<{ task: CareTask | null; created: boolean; existing?: CareTask | null }> {
  const { orderId, orderName } = orderIdentity(order)
  if (!orderId) return { task: null, created: false }

  if (!isShiprocketDeliveredStatus(order)) {
    const err = new Error('Order is not delivered yet') as Error & { status: number }
    err.status = 400
    throw err
  }

  const dedupeKey = makeManualUpsellDedupeKey(orderId)
  const ref = getDb().collection(COL).doc(dedupeKey)
  const existingSnap = await ref.get()
  if (existingSnap.exists) {
    const prev = serializeCareTask(existingSnap.id, existingSnap.data() || {})
    if (isOpenCareTaskStatus(prev.status)) {
      return { task: prev, created: false, existing: prev }
    }
    if (['completed', 'not_interested'].includes(prev.status)) {
      return { task: prev, created: false, existing: prev }
    }
  }

  const assignee = await assignCareExecutiveForOrder(order)
  if (assignee && orderId) {
    await persistOrderAssignment(orderId, orderName, assignee)
  }
  const pack = resolvePackFromOrder(order, await getCareTaskConfig())
  const now = new Date().toISOString()
  const { customerName, phone } = customerFields(order)

  const doc: Omit<CareTask, 'id'> = {
    dedupeKey,
    orderId,
    orderName,
    customerName,
    phone,
    paymentMethod: isCodOrder(order) ? 'cod' : 'prepaid',
    packKey: pack.packKey,
    packLabel: pack.label,
    taskType: 'upsell',
    taskLabel: 'Upsell Call',
    scheduleDay: MANUAL_UPSELL_SCHEDULE_DAY,
    scheduledAt: now,
    orderCreatedAt: createdDate(order).toISOString(),
    priority: 'high',
    status: 'pending',
    assignedTo: assignee,
    notes: [],
    lastCall: null,
    calls: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    source: 'manual',
    overdueNotifiedAt: null,
  }

  try {
    await ref.create({
      ...doc,
      createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (err: any) {
    const code = err?.code
    const msg = String(err?.message || '')
    if (code === 6 || code === 'already-exists' || /already exists/i.test(msg)) {
      const again = await ref.get()
      const prev = serializeCareTask(again.id, again.data() || {})
      return { task: prev, created: false, existing: prev }
    }
    throw err
  }

  await logCareAction({
    action: 'TASK_CREATED',
    orderId,
    orderName,
    taskId: dedupeKey,
    details: {
      taskType: 'upsell',
      scheduleDay: MANUAL_UPSELL_SCHEDULE_DAY,
      assignedTo: assignee?.email || null,
      source: 'manual',
    },
    status: 'success',
  })

  invalidateCareTasksCache()
  return { task: { id: dedupeKey, ...doc }, created: true }
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

  const assignee =
    assigneeOverride === undefined ? await assignCareExecutiveForOrder(order) : assigneeOverride
  const { orderId, orderName } = orderIdentity(order)
  if (assignee && orderId) {
    await persistOrderAssignment(orderId, orderName, assignee)
  }
  const pack = resolvePackFromOrder(order, await getCareTaskConfig())
  const task = await createTaskIfMissing({
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
  return task
}

/** After delivery: introduction (prepaid) or pack follow-ups (COD skips day-0 intro — they already had COD confirmation). */
export async function ensureDeliveredFollowupTasks(
  order: any,
  assigneeOverride?: CareAssignee | null,
): Promise<CareTask[]> {
  if (order?.is_test_order || order?.test === true) return []
  if (!isShiprocketDeliveredStatus(order)) return []

  if (isCodOrder(order)) {
    await autoCloseCodConfirmation(order)
  }

  const config = await getCareTaskConfig()
  const pack = resolvePackFromOrder(order, config)
  const created: CareTask[] = []
  const cod = isCodOrder(order)

  let assignee: CareAssignee | null =
    assigneeOverride === undefined ? await assignCareExecutiveForOrder(order) : assigneeOverride ?? null
  const { orderId, orderName } = orderIdentity(order)
  // Only pin assignment when we resolved it ourselves (not bulk override)
  if (assignee && orderId && assigneeOverride === undefined) {
    await persistOrderAssignment(orderId, orderName, assignee)
  }

  for (const step of pack.plan.steps) {
    // COD: confirmation call already covered pre-delivery — skip intro at delivery
    if (cod && step.day === 0 && step.taskType === 'introduction') continue
    // Prepaid: intro at delivery + later review/upsell days
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
  /** Max orders to process (newest first). Default 150; hard cap 5000 when prepaidOnly. */
  maxOrders?: number
  /** Only prepaid delivered orders (intro + pack follow-ups). */
  prepaidOnly?: boolean
}

/** Idempotent scan of order list — used by sync + cron + Generate. */
export async function processOrdersForCareTasks(
  orders: any[],
  opts: ProcessCareOptions = {},
): Promise<CareProcessResult> {
  await ensureCareTaskConfigSeeded()

  const prepaidOnly = opts.prepaidOnly === true
  const hardCap = prepaidOnly ? 5000 : 400
  const maxOrders = Math.max(1, Math.min(opts.maxOrders ?? (prepaidOnly ? 5000 : 150), hardCap))
  const config = await getCareTaskConfig()

  // COD (confirmation + delivered follow-ups) and prepaid delivered (intro + follow-ups)
  const candidates = orders
    .filter((o) => {
      if (!o || o.is_test_order || o.test === true) return false
      if (prepaidOnly) {
        return !isCodOrder(o) && isShiprocketDeliveredStatus(o)
      }
      if (isCodOrder(o)) return true
      return isShiprocketDeliveredStatus(o)
    })
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
    assigneeEmail: null,
  }

  console.log(
    prepaidOnly
      ? `careTasks: processing ${candidates.length} prepaid delivered orders`
      : `careTasks: processing ${candidates.length} orders (COD + prepaid delivered) with per-order executive assignment`,
  )

  for (const order of candidates) {
    result.scanned += 1
    try {
      const assignee = await assignCareExecutiveForOrder(order)
      if (!result.assigneeEmail && assignee?.email) result.assigneeEmail = assignee.email
      const { orderId, orderName } = orderIdentity(order)
      if (assignee && orderId) {
        await persistOrderAssignment(orderId, orderName, assignee)
      }

      const pack = resolvePackFromOrder(order, config)
      const delivered = isShiprocketDeliveredStatus(order)
      const cod = isCodOrder(order)

      if (cod && !delivered) {
        // COD confirmation only before delivery
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
      } else if (delivered) {
        if (cod) await autoCloseCodConfirmation(order)
        for (const step of pack.plan.steps) {
          if (cod && step.day === 0 && step.taskType === 'introduction') continue
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
  if (isCareConfirmedOutcome(outcome)) return 'care_confirmed'
  if (isCareCancelledOutcome(outcome)) return 'care_cancelled'
  return null
}

export function serializeCareTask(id: string, data: Record<string, any>): CareTask {
  const rawDay = Number(data.scheduleDay ?? 0)
  const scheduleDay = rawDay === 28 ? 23 : rawDay
  const rawLabel = String(data.taskLabel || data.taskType || '')
  const taskLabel = rawLabel.replace(/Day\s*28\b/gi, 'Day 23')

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
    taskLabel,
    scheduleDay,
    scheduledAt: data.scheduledAt || '',
    orderCreatedAt: data.orderCreatedAt || null,
    priority: data.priority || 'medium',
    status: data.status || 'pending',
    assignedTo: data.assignedTo || null,
    escalatedTo: data.escalatedTo || null,
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
