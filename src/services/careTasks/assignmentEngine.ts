import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import {
  CARE_EXECUTIVE_EMAILS,
  FALLBACK_CARE_EXECUTIVES,
  LEGACY_CARE_EXECUTIVE_EMAILS,
  careExecutiveAssignee,
  careExecutiveDisplayName,
  normalizeCareExecutiveEmail,
} from './executiveConfig'
import type { CareAssignee } from './types'
import { logCareAction } from './logger'
import { storeCareOrderAssignment } from '@/src/services/careAssignmentStore'

export interface AssignmentStrategy {
  name: string
  pickNext(executives: CareAssignee[]): Promise<CareAssignee | null>
}

/** Fixed round-robin order: support → Shubham → Kawalnain. */
export { CARE_EXECUTIVE_EMAILS } from './executiveConfig'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').toLowerCase().trim()
}

function phoneFromOrder(order?: {
  phone?: string | null
  customer?: { phone?: string | null } | null
  shipping_address?: { phone?: string | null } | null
  shiprocket_meta?: { customer_phone?: string | null } | null
}): string {
  if (!order) return ''
  const raw =
    order.phone ||
    order.customer?.phone ||
    order.shipping_address?.phone ||
    order.shiprocket_meta?.customer_phone ||
    ''
  return phoneMatchKey(raw)
}

/** Active care executives eligible for assignment. */
export async function listActiveCareExecutives(): Promise<CareAssignee[]> {
  const pool = await resolveCareExecutivePool()
  return pool.length > 0 ? pool : []
}

const ESCALATION_TARGET_ROLES = [
  'super_admin',
  'admin',
  'care_executive',
  'support',
  'employee',
] as const

let escalationTargetsCache: { at: number; users: CareAssignee[] } | null = null
const ESCALATION_TARGETS_TTL_MS = 5 * 60 * 1000

/** Active users an escalated task can be assigned to (admins + care team). */
export async function listEscalationTargets(): Promise<CareAssignee[]> {
  const now = Date.now()
  if (
    escalationTargetsCache &&
    now - escalationTargetsCache.at < ESCALATION_TARGETS_TTL_MS
  ) {
    return escalationTargetsCache.users
  }

  const db = getDb()
  const seen = new Set<string>()
  const results: CareAssignee[] = []

  const addDoc = (doc: admin.firestore.QueryDocumentSnapshot) => {
    const d = doc.data()
    if (d.active === false) return
    const email = normalizeEmail(d.email)
    if (!email || seen.has(email)) return
    seen.add(email)
    results.push({
      userId: doc.id,
      email,
      name: String(d.name || email.split('@')[0] || 'User'),
    })
  }

  const [flagged, ...roleSnaps] = await Promise.all([
    db.collection('users').where('careExecutive', '==', true).get(),
    ...ESCALATION_TARGET_ROLES.map((role) =>
      db.collection('users').where('role', '==', role).get(),
    ),
  ])
  flagged.docs.forEach(addDoc)
  for (const q of roleSnaps) q.docs.forEach(addDoc)

  const users = results.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
  escalationTargetsCache = { at: now, users }
  return users
}

export class RoundRobinStrategy implements AssignmentStrategy {
  name = 'round_robin'

  async pickNext(executives: CareAssignee[]): Promise<CareAssignee | null> {
    const active = executives.filter((e) => e.email)
    if (active.length === 0) return null
    if (active.length === 1) return active[0]

    const ref = getDb().collection('careAssignmentState').doc('round_robin')
    return getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const lastIndex = snap.exists ? Number(snap.data()?.lastIndex ?? -1) : -1
      const nextIndex = (lastIndex + 1) % active.length
      tx.set(
        ref,
        {
          lastIndex: nextIndex,
          lastEmail: active[nextIndex].email,
          strategy: this.name,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return active[nextIndex]
    })
  }
}

/** Extensible entry point — swap strategy later without changing callers. */
let activeStrategy: AssignmentStrategy = new RoundRobinStrategy()

export function setAssignmentStrategy(strategy: AssignmentStrategy) {
  activeStrategy = strategy
}

/** Fallback when Firestore has no flagged executive yet. */
export const DEFAULT_CARE_EXECUTIVE: CareAssignee = FALLBACK_CARE_EXECUTIVES[0]

let cachedExecutivePool: CareAssignee[] | null = null

export function clearCareExecutivePoolCache() {
  cachedExecutivePool = null
}

/** Resolve active care executives in fixed assignment order (Shubham → Kawalnain). */
export async function resolveCareExecutivePool(): Promise<CareAssignee[]> {
  if (cachedExecutivePool?.length) return cachedExecutivePool

  const db = getDb()
  const byEmail = new Map<string, CareAssignee>()

  for (const email of CARE_EXECUTIVE_EMAILS) {
    const q = await db.collection('users').where('email', '==', email).limit(1).get()
    if (!q.empty) {
      const doc = q.docs[0]
      const d = doc.data()
      if (d.active === false) continue
      byEmail.set(email, careExecutiveAssignee(email, doc.id, d.name))
    }
  }

  const pool = CARE_EXECUTIVE_EMAILS.map(
    (email) => byEmail.get(email) || FALLBACK_CARE_EXECUTIVES.find((e) => e.email === email)!,
  ).filter(Boolean)
  cachedExecutivePool = pool
  return cachedExecutivePool
}

let cachedDefaultAssignee: CareAssignee | null = null

/** Resolve primary care assignee (Shubham) from Firestore when present. */
export async function resolveDefaultCareAssignee(): Promise<CareAssignee> {
  const pool = await resolveCareExecutivePool()
  if (pool[0]) return pool[0]
  if (cachedDefaultAssignee) return cachedDefaultAssignee
  cachedDefaultAssignee = DEFAULT_CARE_EXECUTIVE
  return cachedDefaultAssignee
}

async function lookupCustomerAssignee(phoneKey: string): Promise<CareAssignee | null> {
  if (!phoneKey) return null
  const snap = await getDb().collection('careCustomerAssignments').doc(phoneKey).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  const email = normalizeCareExecutiveEmail(data.email)
  if (!email) return null
  const pool = await resolveCareExecutivePool()
  const fromPool = pool.find((e) => e.email === email)
  if (fromPool) return fromPool
  return careExecutiveAssignee(email, String(data.userId || email.split('@')[0]), data.name)
}

/** Sticky per-order assignment — survives sync / generate runs. */
async function lookupOrderAssignee(orderId: string): Promise<CareAssignee | null> {
  const id = String(orderId || '').trim()
  if (!id) return null
  const snap = await getDb().collection('careOrderAssignments').doc(id).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  const email = normalizeCareExecutiveEmail(data.email)
  if (!email) return null
  const pool = await resolveCareExecutivePool()
  const fromPool = pool.find((e) => e.email === email)
  if (fromPool) return fromPool
  return careExecutiveAssignee(email, String(data.userId || email.split('@')[0]), data.name)
}

async function persistCustomerAssignment(phoneKey: string, assignee: CareAssignee, orderId?: string): Promise<void> {
  if (!phoneKey) return
  await getDb()
    .collection('careCustomerAssignments')
    .doc(phoneKey)
    .set(
      {
        phoneKey,
        userId: assignee.userId,
        email: assignee.email,
        name: assignee.name,
        firstOrderId: orderId || null,
        updatedAt: new Date().toISOString(),
        updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
}

export async function persistOrderAssignment(
  orderId: string | number,
  orderName: string | null | undefined,
  assignee: CareAssignee,
): Promise<void> {
  const id = String(orderId || '').trim()
  if (!id) return
  await getDb()
    .collection('careOrderAssignments')
    .doc(id)
    .set(
      {
        orderId: id,
        orderName: orderName || null,
        userId: assignee.userId,
        email: assignee.email,
        name: assignee.name,
        updatedAt: new Date().toISOString(),
        updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
}

/** Lock order + customer to the executive who acted on the task. */
export async function pinCareExecutiveOnTask(
  task: { orderId: string; orderName?: string | null; phone?: string | null },
  assignee: CareAssignee,
): Promise<void> {
  await persistOrderAssignment(task.orderId, task.orderName, assignee)
  const phoneKey = phoneFromOrder({ phone: task.phone })
  if (phoneKey) {
    await persistCustomerAssignment(phoneKey, assignee, task.orderId)
  }
}

function assigneeFromKnownPool(email: string): CareAssignee | null {
  const normalized = normalizeCareExecutiveEmail(email)
  if (!normalized) return null
  return (
    FALLBACK_CARE_EXECUTIVES.find((e) => e.email === normalized) ||
    (CARE_EXECUTIVE_EMAILS.includes(normalized as (typeof CARE_EXECUTIVE_EMAILS)[number])
      ? careExecutiveAssignee(normalized)
      : null)
  )
}

async function moveOpenTasksForOrder(orderId: string, assignee: CareAssignee): Promise<number> {
  const db = getDb()
  const now = new Date().toISOString()
  let updated = 0
  try {
    const snap = await db.collection('careTasks').where('orderId', '==', orderId).get()
    if (snap.empty) {
      try {
        const { reassignCachedTasksForOrder } = require('./taskCache') as {
          reassignCachedTasksForOrder: typeof import('./taskCache').reassignCachedTasksForOrder
        }
        reassignCachedTasksForOrder(orderId, assignee)
      } catch {
        // ignore
      }
      return 0
    }
    let batch = db.batch()
    let batchCount = 0
    for (const doc of snap.docs) {
      const data = doc.data() || {}
      if (normalizeEmail(data.assignedTo?.email) === assignee.email) continue
      batch.update(doc.ref, {
        assignedTo: assignee,
        updatedAt: now,
        updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
      })
      batchCount += 1
      updated += 1
    }
    if (batchCount > 0) await batch.commit()
    try {
      const { reassignCachedTasksForOrder } = require('./taskCache') as {
        reassignCachedTasksForOrder: typeof import('./taskCache').reassignCachedTasksForOrder
      }
      reassignCachedTasksForOrder(orderId, assignee)
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn('careTasks: failed to move open tasks after reassign', err)
  }
  return updated
}

/**
 * Manual reassignment from Order Status.
 * Pins the order immediately; open tasks are moved in the background so the UI does not hang.
 */
export async function reassignCareExecutiveForOrder(params: {
  orderId: string | number
  orderName?: string | null
  email: string
  phone?: string | null
}): Promise<{ assignee: CareAssignee; tasksUpdated: number }> {
  const orderId = String(params.orderId || '').trim()
  if (!orderId) {
    const err = new Error('Order id is required') as Error & { status: number }
    err.status = 400
    throw err
  }

  const email = normalizeCareExecutiveEmail(params.email)
  let assignee = assigneeFromKnownPool(email)
  if (!assignee) {
    const pool = await resolveCareExecutivePool()
    assignee = pool.find((e) => e.email === email) || null
  }
  if (!assignee) {
    const err = new Error('Unknown care executive') as Error & { status: number }
    err.status = 400
    throw err
  }

  await persistOrderAssignment(orderId, params.orderName, assignee)
  const phoneKey = phoneFromOrder({ phone: params.phone })
  if (phoneKey) {
    await persistCustomerAssignment(phoneKey, assignee, orderId)
  }

  setImmediate(() => {
    try {
      storeCareOrderAssignment({
        orderId,
        orderName: params.orderName,
        assignee,
      })
    } catch {
      // disk overlay is best-effort
    }
    void moveOpenTasksForOrder(orderId, assignee!).then((n) => {
      void logCareAction({
        action: 'EXECUTIVE_REASSIGNED',
        orderId,
        orderName: params.orderName || undefined,
        details: {
          assignedTo: assignee!.email,
          assignedName: assignee!.name,
          tasksUpdated: n,
        },
        status: 'success',
      })
    })
  })

  return { assignee, tasksUpdated: 0 }
}

/**
 * Assign a care executive for an order.
 * Repeat customers (same phone) always keep their original executive.
 * New customers rotate: Shubham → Kawalnain → …
 */
export async function assignCareExecutiveForOrder(order?: {
  id?: string | number
  order_id?: string | number
  name?: string | null
  phone?: string | null
  customer?: { phone?: string | null } | null
  shipping_address?: { phone?: string | null } | null
  shiprocket_meta?: { customer_phone?: string | null } | null
}): Promise<CareAssignee | null> {
  const pool = await resolveCareExecutivePool()
  if (!pool.length) return null

  const orderId = String(order?.id ?? order?.order_id ?? '').trim()

  if (orderId) {
    const fromOrder = await lookupOrderAssignee(orderId)
    if (fromOrder) return fromOrder
  }

  const phoneKey = phoneFromOrder(order)
  if (phoneKey) {
    const existing = await lookupCustomerAssignee(phoneKey)
    if (existing) {
      if (orderId) {
        await persistOrderAssignment(orderId, order?.name, existing)
      }
      return existing
    }
  }

  const assignee = await activeStrategy.pickNext(pool)
  if (!assignee) return null

  if (phoneKey) {
    await persistCustomerAssignment(phoneKey, assignee, orderId || undefined)
  }

  if (orderId) {
    await persistOrderAssignment(orderId, order?.name, assignee)
  }

  return assignee
}

/** @deprecated Use assignCareExecutiveForOrder when order context is available. */
export async function assignCareExecutive(): Promise<CareAssignee | null> {
  return assignCareExecutiveForOrder()
}

/** Pick the executive with the fewest open tasks (load-balanced). */
async function pickLeastLoadedExecutive(pool: CareAssignee[]): Promise<CareAssignee | null> {
  if (!pool.length) return null
  if (pool.length === 1) return pool[0]

  const loads = new Map<string, number>()
  for (const exec of pool) loads.set(exec.email, 0)

  const db = getDb()
  for (const status of ['pending', 'rescheduled', 'unreachable'] as const) {
    const snap = await db.collection('careTasks').where('status', '==', status).get()
    for (const doc of snap.docs) {
      const email = normalizeEmail(doc.data()?.assignedTo?.email)
      if (!email || !loads.has(email)) continue
      loads.set(email, (loads.get(email) || 0) + 1)
    }
  }

  return pool.reduce((best, exec) =>
    (loads.get(exec.email) || 0) < (loads.get(best.email) || 0) ? exec : best,
  )
}

async function commitBatch(
  db: admin.firestore.Firestore,
  batch: admin.firestore.WriteBatch,
  batchCount: number,
): Promise<{ batch: admin.firestore.WriteBatch; batchCount: number }> {
  if (batchCount <= 0) return { batch, batchCount }
  await batch.commit()
  return { batch: db.batch(), batchCount: 0 }
}

/**
 * Fill unassigned open tasks across Shubham / Kawalnain.
 * Never moves a customer who already has an executive unless forceEven is explicitly set.
 */
export async function redistributeOpenTasksAmongExecutives(
  opts?: { forceEven?: boolean },
): Promise<number> {
  const forceEven = opts?.forceEven === true
  const pool = await resolveCareExecutivePool()
  if (!pool.length) return 0

  const db = getDb()
  const openStatuses = ['pending', 'rescheduled', 'unreachable', 'escalated'] as const
  type TaskEntry = { ref: admin.firestore.DocumentReference; data: Record<string, any> }
  type Group = { phoneKey?: string; tasks: TaskEntry[] }

  const tasksByPhone = new Map<string, TaskEntry[]>()
  const noPhoneTasks: TaskEntry[] = []

  for (const status of openStatuses) {
    const snap = await db.collection('careTasks').where('status', '==', status).get()
    for (const doc of snap.docs) {
      const data = doc.data() || {}
      const phoneKey = phoneMatchKey(data.phone)
      const entry = { ref: doc.ref, data }
      if (phoneKey) {
        const list = tasksByPhone.get(phoneKey) || []
        list.push(entry)
        tasksByPhone.set(phoneKey, list)
      } else {
        noPhoneTasks.push(entry)
      }
    }
  }

  const groups: Group[] = [
    ...[...tasksByPhone.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([phoneKey, tasks]) => ({ phoneKey, tasks })),
    ...noPhoneTasks.map((task) => ({ tasks: [task] })),
  ]

  const loads = new Map<string, number>()
  for (const exec of pool) loads.set(exec.email, 0)

  const pickLeastLoaded = (): CareAssignee =>
    pool.reduce((best, exec) =>
      (loads.get(exec.email) || 0) < (loads.get(best.email) || 0) ? exec : best,
    )

  const assigneeFromEmail = (email: string, data?: Record<string, any>): CareAssignee | null => {
    const normalized = normalizeCareExecutiveEmail(email)
    if (!normalized) return null
    const fromPool = pool.find((e) => e.email === normalized)
    if (fromPool) return fromPool
    return careExecutiveAssignee(
      normalized,
      String(data?.assignedTo?.userId || normalized.split('@')[0]),
      data?.assignedTo?.name,
    )
  }

  const assignment = new Map<Group, CareAssignee>()
  const unassigned: Group[] = []

  for (const group of groups) {
    if (forceEven) {
      unassigned.push(group)
      continue
    }

    const emails = [
      ...new Set(
        group.tasks
          .map((t) => normalizeCareExecutiveEmail(t.data.assignedTo?.email))
          .filter(Boolean),
      ),
    ]

    if (emails.length === 0) {
      unassigned.push(group)
      continue
    }

    if (emails.length === 1) {
      const assignee = assigneeFromEmail(emails[0], group.tasks[0]?.data)
      if (assignee && loads.has(assignee.email)) {
        assignment.set(group, assignee)
        loads.set(assignee.email, (loads.get(assignee.email) || 0) + group.tasks.length)
        continue
      }
      // Inactive executives (Support, etc.) get filled like unassigned.
      unassigned.push(group)
      continue
    }

    // Mixed assignees on one phone — keep each task as-is, never steal the group.
    for (const task of group.tasks) {
      const email = normalizeCareExecutiveEmail(task.data.assignedTo?.email)
      if (email && loads.has(email)) {
        loads.set(email, (loads.get(email) || 0) + 1)
      }
    }
  }

  unassigned.sort((a, b) => b.tasks.length - a.tasks.length)
  for (const group of unassigned) {
    const assignee = pickLeastLoaded()
    assignment.set(group, assignee)
    loads.set(assignee.email, (loads.get(assignee.email) || 0) + group.tasks.length)
  }

  let updated = 0
  const now = new Date().toISOString()
  let batch = db.batch()
  let batchCount = 0

  const queueAssignee = async (assignee: CareAssignee, group: Group) => {
    const seenOrders = new Set<string>()
    for (const { ref, data } of group.tasks) {
      const current = normalizeEmail(data.assignedTo?.email)
      if (current !== assignee.email) {
        batch.update(ref, {
          assignedTo: assignee,
          updatedAt: now,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        })
        batchCount += 1
        updated += 1
        if (batchCount >= 400) {
          ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
        }
      }

      const orderId = String(data.orderId || '').trim()
      if (orderId && !seenOrders.has(orderId)) {
        seenOrders.add(orderId)
        batch.set(
          db.collection('careOrderAssignments').doc(orderId),
          {
            orderId,
            orderName: data.orderName || null,
            userId: assignee.userId,
            email: assignee.email,
            name: assignee.name,
            updatedAt: now,
            updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        batchCount += 1
        if (batchCount >= 400) {
          ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
        }
      }
    }

    if (group.phoneKey) {
      batch.set(
        db.collection('careCustomerAssignments').doc(group.phoneKey),
        {
          phoneKey: group.phoneKey,
          userId: assignee.userId,
          email: assignee.email,
          name: assignee.name,
          firstOrderId: group.tasks[0]?.data?.orderId || null,
          updatedAt: now,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      batchCount += 1
      if (batchCount >= 400) {
        ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
      }
    }
  }

  for (const group of groups) {
    const assignee = assignment.get(group)
    if (!assignee) continue
    await queueAssignee(assignee, group)
  }

  ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))

  try {
    const { invalidateCareTasksCache } = require('./taskCache') as {
      invalidateCareTasksCache: () => void
    }
    invalidateCareTasksCache()
  } catch {
    // cache module unavailable in some scripts
  }

  console.log(
    `careTasks: redistributed ${updated} tasks — ${pool
      .map((e) => `${e.name}:${loads.get(e.email) || 0}`)
      .join(' · ')}`,
  )
  return updated
}

const FORCE_SPLIT_CUTOFF_ISO = '2026-09-02T08:16:00.000Z'
/** Last known-good assignment file, committed 2026-09-02 12:30:50 IST. */
const PRE_SPLIT_SNAPSHOT_ISO = '2026-09-02T07:00:50.000Z'
const LOCAL_ASSIGNMENTS_PATH = path.join(process.cwd(), '.care-order-assignments.json')

function millisFromUnknown(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const t = new Date(value).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (value instanceof Date) return value.getTime()
  if (
    typeof value === 'object' &&
    value &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return (value as admin.firestore.Timestamp).toDate().getTime()
    } catch {
      return 0
    }
  }
  return 0
}

function emailFromLogDetails(details: unknown): string {
  if (!details || typeof details !== 'object') return ''
  return emailFromUnknown((details as Record<string, unknown>).assignedTo)
}

function emailFromUnknown(raw: unknown): string {
  if (typeof raw === 'string') return normalizeCareExecutiveEmail(raw)
  if (raw && typeof raw === 'object' && 'email' in (raw as object)) {
    return normalizeCareExecutiveEmail((raw as { email?: string }).email)
  }
  return ''
}

type OriginalAssignee = { email: string; name?: string; at: number; source: string }

function considerOriginal(
  map: Map<string, OriginalAssignee>,
  key: string,
  email: string,
  at: number,
  source: string,
  name?: string,
) {
  const normalized = normalizeCareExecutiveEmail(email)
  if (!key || !normalized) return
  const prev = map.get(key)
  const rank = (s: string) =>
    s === 'local' ? 3 : s === 'recent_log' ? 2 : s === 'snapshot' ? 1 : 0
  if (!prev) {
    map.set(key, { email: normalized, name, at, source })
    return
  }
  if (rank(source) > rank(prev.source)) {
    map.set(key, { email: normalized, name, at, source })
    return
  }
  if (rank(source) === rank(prev.source) && at > 0 && at >= prev.at) {
    map.set(key, { email: normalized, name, at, source })
  }
}

function ingestAssignmentStore(
  byOrder: Map<string, OriginalAssignee>,
  store: Record<string, any>,
  source: string,
  cutoffMs: number,
) {
  for (const value of Object.values(store || {})) {
    if (!value || typeof value !== 'object') continue
    const orderId = String((value as any).orderId || '').trim()
    const email = normalizeCareExecutiveEmail((value as any).email)
    const at = millisFromUnknown((value as any).updatedAt)
    if (!orderId || !email) continue
    if (source !== 'snapshot' && at >= cutoffMs) continue
    considerOriginal(byOrder, orderId, email, at, source, String((value as any).name || ''))
  }
}

export type RestoreCareAssignmentsResult = {
  dryRun: boolean
  originals: number
  restoredTasks: number
  restoredOrders: number
  restoredCustomers: number
  alreadyCorrect: number
  byEmail: Record<string, number>
}

/**
 * Restore pre-split executive ownership onto care tasks + order/customer assignment docs.
 * Sources: git/local snapshot (before the 50/50 rewrite) and TASK_CREATED logs.
 */
export async function restoreOriginalCareAssignments(opts?: {
  cutoffIso?: string
  dryRun?: boolean
  orderSnapshot?: Record<string, any>
}): Promise<RestoreCareAssignmentsResult> {
  const cutoffMs = new Date(opts?.cutoffIso || FORCE_SPLIT_CUTOFF_ISO).getTime()
  const snapshotMs = new Date(PRE_SPLIT_SNAPSHOT_ISO).getTime()
  const dryRun = opts?.dryRun === true
  const db = getDb()
  const pool = await resolveCareExecutivePool()
  const byEmailPool = new Map(pool.map((e) => [e.email, e]))

  const resolveAssignee = (email: string, name?: string, userId?: string): CareAssignee => {
    const normalized = normalizeCareExecutiveEmail(email)
    const fromPool = byEmailPool.get(normalized)
    if (fromPool) return fromPool
    return careExecutiveAssignee(normalized, userId, name)
  }

  const byOrder = new Map<string, OriginalAssignee>()
  const byTask = new Map<string, OriginalAssignee>()

  if (opts?.orderSnapshot) {
    ingestAssignmentStore(byOrder, opts.orderSnapshot, 'snapshot', cutoffMs)
  }

  try {
    if (fs.existsSync(LOCAL_ASSIGNMENTS_PATH)) {
      const local = JSON.parse(fs.readFileSync(LOCAL_ASSIGNMENTS_PATH, 'utf-8')) as Record<string, any>
      ingestAssignmentStore(byOrder, local, 'local', cutoffMs)
    }
  } catch (err) {
    console.warn('careTasks: could not read local assignment snapshot', err)
  }

  let last: admin.firestore.QueryDocumentSnapshot | undefined
  let scannedLogs = 0
  while (true) {
    let q = db
      .collection('careTaskLogs')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(500)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    for (const doc of snap.docs) {
      scannedLogs += 1
      const data = doc.data() || {}
      const at = millisFromUnknown(data.createdAt)
      // Ignore logs from before the last good snapshot — those still point at
      // Support / round-robin from months ago, not the pre-split owners.
      if (!at || at < snapshotMs || at >= cutoffMs) continue
      const email = emailFromLogDetails(data.details)
      if (!email) continue
      const source = 'recent_log'
      const taskId = String(data.taskId || '').trim()
      const orderId = String(data.orderId || '').trim()
      if (taskId) considerOriginal(byTask, taskId, email, at, source)
      if (orderId) considerOriginal(byOrder, orderId, email, at, source)
    }
    last = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }
  console.log(
    `careTasks: restore scanned ${scannedLogs} logs · ${byOrder.size} orders · ${byTask.size} tasks`,
  )

  const now = new Date().toISOString()
  let batch = db.batch()
  let batchCount = 0
  let restoredTasks = 0
  let restoredOrders = 0
  let restoredCustomers = 0
  let alreadyCorrect = 0
  const counts: Record<string, number> = {}
  const phoneAssignee = new Map<string, { assignee: CareAssignee; n: number }>()

  const queueSet = async (
    ref: admin.firestore.DocumentReference,
    data: Record<string, unknown>,
    merge = true,
  ) => {
    if (dryRun) return
    if (merge) batch.set(ref, data, { merge: true })
    else batch.set(ref, data)
    batchCount += 1
    if (batchCount >= 400) {
      ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
    }
  }

  const tasksSnap = await db.collection('careTasks').get()
  for (const doc of tasksSnap.docs) {
    const data = doc.data() || {}
    const original =
      byTask.get(doc.id) ||
      byTask.get(String(data.dedupeKey || '')) ||
      byOrder.get(String(data.orderId || '').trim())
    if (!original) continue
    counts[original.email] = (counts[original.email] || 0) + 1
    const current = normalizeCareExecutiveEmail(data.assignedTo?.email)
    const assignee = resolveAssignee(original.email, original.name, data.assignedTo?.userId)

    const phoneKey = phoneMatchKey(data.phone)
    if (phoneKey) {
      const prev = phoneAssignee.get(phoneKey)
      if (!prev) phoneAssignee.set(phoneKey, { assignee, n: 1 })
      else if (prev.assignee.email === assignee.email) prev.n += 1
      else if (assignee.email && prev.n < 1) phoneAssignee.set(phoneKey, { assignee, n: 1 })
    }

    if (current === assignee.email) {
      alreadyCorrect += 1
      continue
    }
    restoredTasks += 1
    await queueSet(doc.ref, {
      assignedTo: assignee,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  for (const [orderId, original] of byOrder) {
    const assignee = resolveAssignee(original.email, original.name)
    restoredOrders += 1
    await queueSet(db.collection('careOrderAssignments').doc(orderId), {
      orderId,
      userId: assignee.userId,
      email: assignee.email,
      name: assignee.name,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  for (const [phoneKey, { assignee }] of phoneAssignee) {
    restoredCustomers += 1
    await queueSet(db.collection('careCustomerAssignments').doc(phoneKey), {
      phoneKey,
      userId: assignee.userId,
      email: assignee.email,
      name: assignee.name,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  if (!dryRun) {
    ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
    try {
      const { invalidateCareTasksCache } = require('./taskCache') as {
        invalidateCareTasksCache: () => void
      }
      invalidateCareTasksCache()
    } catch {
      // ignore
    }
    try {
      const store = fs.existsSync(LOCAL_ASSIGNMENTS_PATH)
        ? (JSON.parse(fs.readFileSync(LOCAL_ASSIGNMENTS_PATH, 'utf-8')) as Record<string, any>)
        : {}
      for (const [orderId, original] of byOrder) {
        const assignee = resolveAssignee(original.email, original.name)
        const entry = {
          orderId,
          orderName: store[orderId]?.orderName || null,
          email: assignee.email,
          name: assignee.name,
          label: careExecutiveDisplayName(assignee.email, assignee.name),
          updatedAt: now,
        }
        store[orderId] = entry
        const nameKey = entry.orderName
          ? `name:${String(entry.orderName).replace(/^#/, '').trim().toLowerCase()}`
          : ''
        if (nameKey) store[nameKey] = entry
      }
      fs.writeFileSync(LOCAL_ASSIGNMENTS_PATH, JSON.stringify(store, null, 2), 'utf-8')
    } catch (err) {
      console.warn('careTasks: could not rewrite local assignment file', err)
    }
  }

  console.log(
    `careTasks: restore ${dryRun ? 'dry-run ' : ''}${restoredTasks} tasks · ${restoredOrders} orders · ${restoredCustomers} phones — ${Object.entries(
      counts,
    )
      .map(([email, n]) => `${email}:${n}`)
      .join(' · ')}`,
  )

  return {
    dryRun,
    originals: byOrder.size,
    restoredTasks,
    restoredOrders,
    restoredCustomers,
    alreadyCorrect,
    byEmail: counts,
  }
}

/** Migrate legacy executive1/2 emails + display names across Firestore. */
export async function migrateLegacyCareExecutiveEmails(): Promise<number> {
  const ref = getDb().collection('careAssignmentState').doc('executive_email_migration_v1')
  const snap = await ref.get()
  if (snap.exists) return 0

  const db = getDb()
  let updated = 0
  let batch = db.batch()
  let batchCount = 0
  const now = new Date().toISOString()

  const queueUpdate = async (docRef: admin.firestore.DocumentReference, patch: Record<string, unknown>) => {
    batch.update(docRef, patch)
    batchCount += 1
    updated += 1
    if (batchCount >= 400) {
      await batch.commit()
      batch = db.batch()
      batchCount = 0
    }
  }

  for (const [legacyEmail, newEmail] of Object.entries(LEGACY_CARE_EXECUTIVE_EMAILS)) {
    const assignee = careExecutiveAssignee(newEmail)
    const userSnap = await db.collection('users').where('email', '==', legacyEmail).limit(1).get()
    for (const doc of userSnap.docs) {
      await queueUpdate(doc.ref, {
        email: newEmail,
        name: assignee.name,
        careExecutive: true,
        active: true,
        updatedAt: now,
      })
    }
  }

  const taskSnap = await db.collection('careTasks').get()
  for (const doc of taskSnap.docs) {
    const data = doc.data() || {}
    const raw = normalizeEmail(data.assignedTo?.email)
    const newEmail = LEGACY_CARE_EXECUTIVE_EMAILS[raw]
    if (!newEmail) continue
    await queueUpdate(doc.ref, {
      assignedTo: careExecutiveAssignee(newEmail),
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const custSnap = await db.collection('careCustomerAssignments').get()
  for (const doc of custSnap.docs) {
    const data = doc.data() || {}
    const newEmail = LEGACY_CARE_EXECUTIVE_EMAILS[normalizeEmail(data.email)]
    if (!newEmail) continue
    const assignee = careExecutiveAssignee(newEmail)
    await queueUpdate(doc.ref, {
      email: newEmail,
      name: assignee.name,
      userId: assignee.userId,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const orderSnap = await db.collection('careOrderAssignments').get()
  for (const doc of orderSnap.docs) {
    const data = doc.data() || {}
    const newEmail = LEGACY_CARE_EXECUTIVE_EMAILS[normalizeEmail(data.email)]
    if (!newEmail) continue
    const assignee = careExecutiveAssignee(newEmail)
    await queueUpdate(doc.ref, {
      email: newEmail,
      name: assignee.name,
      userId: assignee.userId,
      updatedAt: now,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  if (batchCount > 0) await batch.commit()
  clearCareExecutivePoolCache()
  await ref.set({
    completedAt: now,
    recordsUpdated: updated,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
  })
  return updated
}
