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

/** Split open tasks evenly across Shubham / Kawalnain, keeping each customer on one executive. */
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

  const currentExecFor = (tasks: TaskEntry[]): CareAssignee | null => {
    if (forceEven) return null
    const emails = new Set(
      tasks
        .map((t) => normalizeEmail(t.data.assignedTo?.email))
        .filter((email) => email && pool.some((e) => e.email === email)),
    )
    if (emails.size !== 1) return null
    return pool.find((e) => e.email === [...emails][0]) || null
  }

  const assignment = new Map<Group, CareAssignee>()
  for (const group of groups) {
    const current = currentExecFor(group.tasks)
    if (!current) continue
    assignment.set(group, current)
    loads.set(current.email, (loads.get(current.email) || 0) + group.tasks.length)
  }

  const unassigned = groups
    .filter((g) => !assignment.has(g))
    .sort((a, b) => b.tasks.length - a.tasks.length)
  for (const group of unassigned) {
    const assignee = pickLeastLoaded()
    assignment.set(group, assignee)
    loads.set(assignee.email, (loads.get(assignee.email) || 0) + group.tasks.length)
  }

  if (!forceEven && pool.length >= 2) {
    const maxIter = groups.length * 4
    for (let i = 0; i < maxIter; i++) {
      const heavy = pool.reduce((a, b) =>
        (loads.get(a.email) || 0) >= (loads.get(b.email) || 0) ? a : b,
      )
      const light = pool.reduce((a, b) =>
        (loads.get(a.email) || 0) <= (loads.get(b.email) || 0) ? a : b,
      )
      const gap = (loads.get(heavy.email) || 0) - (loads.get(light.email) || 0)
      if (gap <= 1) break

      const candidates = groups
        .filter((g) => assignment.get(g)?.email === heavy.email)
        .sort((a, b) => a.tasks.length - b.tasks.length)

      let moved = false
      for (const group of candidates) {
        const n = group.tasks.length
        const newGap = Math.abs(
          (loads.get(heavy.email) || 0) - n - ((loads.get(light.email) || 0) + n),
        )
        if (newGap < gap) {
          assignment.set(group, light)
          loads.set(heavy.email, (loads.get(heavy.email) || 0) - n)
          loads.set(light.email, (loads.get(light.email) || 0) + n)
          moved = true
          break
        }
      }
      if (!moved) break
    }
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
