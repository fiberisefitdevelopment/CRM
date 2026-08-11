/**
 * Care executive assignment overlay for Orders + Order Status lists.
 * Hydrates from Firestore careOrderAssignments + care tasks.
 */

import fs from 'fs'
import path from 'path'
import type { CareAssignee } from '@/src/services/careTasks/types'
import { careExecutiveDisplayName } from '@/src/services/careTasks/executiveConfig'

export interface CareOrderAssignmentEntry {
  orderId: string
  orderName?: string | null
  email: string
  name: string
  label: string
  updatedAt?: string
}

const STORE_PATH = path.join(process.cwd(), '.care-order-assignments.json')
const HYDRATE_TTL_MS = 60_000

type AssignmentStore = Record<string, CareOrderAssignmentEntry>

let memoryStore: AssignmentStore | null = null
let hydrateExpiresAt = 0
let hydrateInflight: Promise<void> | null = null

function assignmentLabel(assignee: Pick<CareAssignee, 'name' | 'email'>): string {
  return careExecutiveDisplayName(assignee.email, assignee.name)
}

function loadStore(): AssignmentStore {
  if (memoryStore) return memoryStore
  try {
    if (fs.existsSync(STORE_PATH)) {
      memoryStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as AssignmentStore
      return memoryStore
    }
  } catch {
    // corrupt — start fresh
  }
  memoryStore = {}
  return memoryStore
}

function reloadStoreFromDisk(): AssignmentStore {
  memoryStore = null
  return loadStore()
}

function saveStore(store: AssignmentStore) {
  memoryStore = store
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('⚠️ Failed to persist care order assignments:', e)
  }
}

function keysFor(orderId: string | number, orderName?: string | null): string[] {
  const keys: string[] = []
  const id = String(orderId || '').trim()
  if (id) keys.push(id)
  const clean = String(orderName || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
  if (clean) keys.push(`name:${clean}`)
  return keys
}

function upsertAssignment(
  store: AssignmentStore,
  params: {
    orderId: string | number
    orderName?: string | null
    assignee: Pick<CareAssignee, 'email' | 'name'>
    updatedAt?: string
  },
): CareOrderAssignmentEntry {
  const email = String(params.assignee.email || '').toLowerCase().trim()
  const entry: CareOrderAssignmentEntry = {
    orderId: String(params.orderId),
    orderName: params.orderName || null,
    email,
    name: String(params.assignee.name || email.split('@')[0] || 'Executive'),
    label: assignmentLabel({ email, name: params.assignee.name }),
    updatedAt: params.updatedAt || new Date().toISOString(),
  }
  for (const k of keysFor(params.orderId, params.orderName)) {
    const prev = store[k]
    if (prev?.updatedAt && entry.updatedAt && prev.updatedAt > entry.updatedAt) continue
    store[k] = entry
  }
  return entry
}

export function lookupCareOrderAssignment(
  orderId: string | number,
  orderName?: string | null,
): CareOrderAssignmentEntry | null {
  const store = loadStore()
  for (const k of keysFor(orderId, orderName)) {
    if (store[k]) return store[k]
  }
  return null
}

export function storeCareOrderAssignment(params: {
  orderId: string | number
  orderName?: string | null
  assignee: Pick<CareAssignee, 'email' | 'name'>
}): CareOrderAssignmentEntry {
  const store = loadStore()
  const entry = upsertAssignment(store, params)
  saveStore(store)
  return entry
}

type AssignmentSourceTask = {
  orderId?: string | null
  orderName?: string | null
  assignedTo?: { email?: string | null; name?: string | null } | null
  updatedAt?: string | null
  createdAt?: string | null
}

export function syncAssignmentsFromCareTasks(tasks: AssignmentSourceTask[]): number {
  if (!tasks?.length) return 0
  const store = loadStore()
  let added = 0
  for (const task of tasks) {
    const email = String(task.assignedTo?.email || '').trim()
    if (!email || (!task.orderId && !task.orderName)) continue
    const before = lookupCareOrderAssignment(task.orderId || '', task.orderName)
    upsertAssignment(store, {
      orderId: task.orderId || '',
      orderName: task.orderName,
      assignee: {
        email,
        name: String(task.assignedTo?.name || email.split('@')[0]),
      },
      updatedAt: task.updatedAt || task.createdAt || new Date().toISOString(),
    })
    const after = lookupCareOrderAssignment(task.orderId || '', task.orderName)
    if (!before || before.email !== after?.email) added += 1
  }
  if (added > 0) saveStore(store)
  else memoryStore = store
  return added
}

export async function ensureCareAssignmentsHydrated(): Promise<void> {
  reloadStoreFromDisk()

  try {
    const { getCachedCareTasks } = require('@/src/services/careTasks/taskCache') as {
      getCachedCareTasks: () => AssignmentSourceTask[] | null
    }
    const cached = getCachedCareTasks()
    if (cached?.length) syncAssignmentsFromCareTasks(cached)
  } catch {
    // care tasks module unavailable
  }

  if (Date.now() < hydrateExpiresAt) return
  if (hydrateInflight) return hydrateInflight

  hydrateInflight = (async () => {
    try {
      const admin = require('firebase-admin') as typeof import('firebase-admin')
      const { getFirebaseAdmin } = require('@/src/firebase/firebase.config') as {
        getFirebaseAdmin: () => any
      }
      const db = admin.firestore(getFirebaseAdmin())
      const store = loadStore()
      let changed = false

      try {
        const snap = await db.collection('careOrderAssignments').limit(1000).get()
        for (const doc of snap.docs) {
          const data = doc.data() || {}
          const email = String(data.email || '').trim()
          if (!email) continue
          const before = lookupCareOrderAssignment(data.orderId || doc.id, data.orderName)
          upsertAssignment(store, {
            orderId: data.orderId || doc.id,
            orderName: data.orderName,
            assignee: { email, name: String(data.name || email.split('@')[0]) },
            updatedAt: data.updatedAt || undefined,
          })
          const after = lookupCareOrderAssignment(data.orderId || doc.id, data.orderName)
          if (!before || before.email !== after?.email) changed = true
        }
      } catch (e) {
        console.warn('⚠️ careOrderAssignments hydrate failed:', (e as Error)?.message || e)
      }

      try {
        const snap = await db.collection('careTasks').limit(1000).get()
        const added = syncAssignmentsFromCareTasks(
          snap.docs.map((d) => {
            const data = d.data() || {}
            return {
              orderId: data.orderId,
              orderName: data.orderName,
              assignedTo: data.assignedTo,
              updatedAt: data.updatedAt,
              createdAt: data.createdAt,
            }
          }),
        )
        if (added > 0) changed = true
      } catch (e) {
        console.warn('⚠️ care task assignment hydrate failed:', (e as Error)?.message || e)
      }

      if (changed) saveStore(store)
      else memoryStore = store
      hydrateExpiresAt = Date.now() + HYDRATE_TTL_MS
    } catch (e) {
      console.warn('⚠️ Failed to hydrate care assignments:', (e as Error)?.message || e)
      hydrateExpiresAt = Date.now() + 15_000
    } finally {
      hydrateInflight = null
    }
  })()

  return hydrateInflight
}

export function applyCareAssignmentsToOrders<
  T extends {
    id?: string | number
    name?: string | null
    care_executive?: CareOrderAssignmentEntry | null
    customer?: { phone?: string | null } | null
    shipping_address?: { phone?: string | null } | null
    phone?: string | null
  },
>(orders: T[]): T[] {
  const store = loadStore()
  if (!Object.keys(store).length) return orders

  return orders.map((o) => {
    const byId = store[String(o.id)]
    const clean = String(o.name || '')
      .replace(/^#/, '')
      .trim()
      .toLowerCase()
    const byName = clean ? store[`name:${clean}`] : null
    const assignment = byId || byName || null
    if (!assignment) return o
    return { ...o, care_executive: assignment }
  })
}
