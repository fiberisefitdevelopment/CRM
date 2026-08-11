import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import type { CareAssignee } from './types'

export interface AssignmentStrategy {
  name: string
  pickNext(executives: CareAssignee[]): Promise<CareAssignee | null>
}

/** Fixed round-robin order: support → executive1 → executive2. */
export const CARE_EXECUTIVE_EMAILS = [
  'support@fiberisefit.com',
  'executive1@fiberisefit.com',
  'executive2@fiberisefit.com',
] as const

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

/** Active users an escalated task can be assigned to (admins + care team). */
export async function listEscalationTargets(): Promise<CareAssignee[]> {
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

  const flagged = await db.collection('users').where('careExecutive', '==', true).get()
  flagged.docs.forEach(addDoc)

  for (const role of ESCALATION_TARGET_ROLES) {
    const q = await db.collection('users').where('role', '==', role).get()
    q.docs.forEach(addDoc)
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
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
export const DEFAULT_CARE_EXECUTIVE: CareAssignee = {
  userId: 'support-fiberisefit',
  email: 'support@fiberisefit.com',
  name: 'Customer Care Executive',
}

const FALLBACK_EXECUTIVES: CareAssignee[] = [
  DEFAULT_CARE_EXECUTIVE,
  {
    userId: 'executive1-fiberisefit',
    email: 'executive1@fiberisefit.com',
    name: 'Executive 1',
  },
  {
    userId: 'executive2-fiberisefit',
    email: 'executive2@fiberisefit.com',
    name: 'Executive 2',
  },
]

let cachedExecutivePool: CareAssignee[] | null = null

/** Resolve the 3 care executives in fixed assignment order. */
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
      byEmail.set(email, {
        userId: doc.id,
        email,
        name: String(d.name || email.split('@')[0] || 'Executive'),
      })
    }
  }

  const pool = CARE_EXECUTIVE_EMAILS.map((email) => byEmail.get(email) || FALLBACK_EXECUTIVES.find((e) => e.email === email)!)
  cachedExecutivePool = pool.filter(Boolean)
  return cachedExecutivePool
}

let cachedDefaultAssignee: CareAssignee | null = null

/** Resolve support@ from Firestore when present; otherwise use the static default. */
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
  const email = normalizeEmail(data.email)
  if (!email) return null
  const pool = await resolveCareExecutivePool()
  const fromPool = pool.find((e) => e.email === email)
  if (fromPool) return fromPool
  return {
    userId: String(data.userId || email.split('@')[0]),
    email,
    name: String(data.name || email.split('@')[0] || 'Executive'),
  }
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

/**
 * Assign a care executive for an order.
 * Repeat customers (same phone) always keep their original executive.
 * New customers rotate: support@ → executive1 → executive2 → …
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

  const phoneKey = phoneFromOrder(order)
  if (phoneKey) {
    const existing = await lookupCustomerAssignee(phoneKey)
    if (existing) {
      const orderId = String(order?.id ?? order?.order_id ?? '')
      if (orderId) {
        await persistOrderAssignment(orderId, order?.name, existing)
      }
      return existing
    }
  }

  const assignee = await pickLeastLoadedExecutive(pool)
  if (!assignee) return null

  if (phoneKey) {
    const orderId = String(order?.id ?? order?.order_id ?? '')
    await persistCustomerAssignment(phoneKey, assignee, orderId || undefined)
  }

  const orderId = String(order?.id ?? order?.order_id ?? '')
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

/** Split open tasks evenly across all 3 executives, keeping each customer on one executive. */
export async function redistributeOpenTasksAmongExecutives(): Promise<number> {
  const pool = await resolveCareExecutivePool()
  if (!pool.length) return 0

  const db = getDb()
  const openStatuses = ['pending', 'rescheduled', 'unreachable'] as const
  const tasksByPhone = new Map<string, Array<{ ref: admin.firestore.DocumentReference; data: Record<string, any> }>>()
  const noPhoneTasks: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, any> }> = []

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

  const customerGroups = [...tasksByPhone.entries()].sort((a, b) => b[1].length - a[1].length)
  const loads = new Map<string, number>()
  for (const exec of pool) loads.set(exec.email, 0)

  const pickLeastLoaded = (): CareAssignee => {
    return pool.reduce((best, exec) =>
      (loads.get(exec.email) || 0) < (loads.get(best.email) || 0) ? exec : best,
    )
  }

  let updated = 0
  const now = new Date().toISOString()
  let batch = db.batch()
  let batchCount = 0

  const queueAssignee = async (
    assignee: CareAssignee,
    tasks: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, any> }>,
    phoneKey?: string,
  ) => {
    const seenOrders = new Set<string>()
    for (const { ref, data } of tasks) {
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

    if (phoneKey) {
      batch.set(
        db.collection('careCustomerAssignments').doc(phoneKey),
        {
          phoneKey,
          userId: assignee.userId,
          email: assignee.email,
          name: assignee.name,
          firstOrderId: tasks[0]?.data?.orderId || null,
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

  for (const [phoneKey, tasks] of customerGroups) {
    const assignee = pickLeastLoaded()
    loads.set(assignee.email, (loads.get(assignee.email) || 0) + tasks.length)
    await queueAssignee(assignee, tasks, phoneKey)
  }

  for (const task of noPhoneTasks) {
    const assignee = pickLeastLoaded()
    loads.set(assignee.email, (loads.get(assignee.email) || 0) + 1)
    await queueAssignee(assignee, [task])
  }

  ;({ batch, batchCount } = await commitBatch(db, batch, batchCount))
  return updated
}
