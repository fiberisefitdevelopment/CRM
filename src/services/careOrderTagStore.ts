/**
 * CRM care-executive COD tags (display only — does not cancel/fulfill in Shopify).
 * Shown as small badges on Orders + Order Status lists.
 *
 * Local JSON is a fast cache. Care-task confirmations in Firestore are the
 * source of truth — sync/hydrate from tasks so tags survive missed disk writes.
 */

import fs from 'fs'
import path from 'path'
import {
  isCareConfirmedOutcome,
  isCareCancelledOutcome,
} from '@/src/services/careTasks/actorLabel'
import {
  careOrderTagLabel,
  type CareOrderTagEntry,
  type CareOrderTagKind,
} from '@/src/utils/careOrderTags'

export type { CareOrderTagEntry, CareOrderTagKind }
export { careOrderTagLabel, careOrderTagTone } from '@/src/utils/careOrderTags'

const STORE_PATH = path.join(process.cwd(), '.care-order-tags.json')
const HYDRATE_TTL_MS = 60_000

type TagStore = Record<string, CareOrderTagEntry>

let memoryStore: TagStore | null = null
let hydrateExpiresAt = 0
let hydrateInflight: Promise<void> | null = null

function loadStore(): TagStore {
  if (memoryStore) return memoryStore
  try {
    if (fs.existsSync(STORE_PATH)) {
      memoryStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as TagStore
      return memoryStore
    }
  } catch {
    // corrupt — start fresh
  }
  memoryStore = {}
  return memoryStore
}

/** Re-read disk into memory (picks up backfills / other processes). */
function reloadStoreFromDisk(): TagStore {
  memoryStore = null
  return loadStore()
}

function saveStore(store: TagStore) {
  memoryStore = store
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('⚠️ Failed to persist care order tags:', e)
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

function upsertTag(
  store: TagStore,
  params: {
    orderId: string | number
    orderName?: string | null
    kind: CareOrderTagKind
    byEmail?: string | null
    byName?: string | null
    updatedAt?: string
  },
): CareOrderTagEntry {
  const entry: CareOrderTagEntry = {
    kind: params.kind,
    label: careOrderTagLabel(params.kind),
    orderId: String(params.orderId),
    orderName: params.orderName || null,
    byEmail: params.byEmail || null,
    byName: params.byName || null,
    updatedAt: params.updatedAt || new Date().toISOString(),
  }
  for (const k of keysFor(params.orderId, params.orderName)) {
    const prev = store[k]
    // Keep newer confirmation; don't clobber with older hydrate data
    if (prev?.updatedAt && entry.updatedAt && prev.updatedAt > entry.updatedAt) continue
    store[k] = entry
  }
  return entry
}

export function lookupCareOrderTag(
  orderId: string | number,
  orderName?: string | null,
): CareOrderTagEntry | null {
  const store = loadStore()
  for (const k of keysFor(orderId, orderName)) {
    if (store[k]) return store[k]
  }
  return null
}

export function storeCareOrderTag(params: {
  orderId: string | number
  orderName?: string | null
  kind: CareOrderTagKind
  byEmail?: string | null
  byName?: string | null
}): CareOrderTagEntry {
  const store = loadStore()
  const entry = upsertTag(store, params)
  saveStore(store)
  return entry
}

type CareTagSourceTask = {
  orderId?: string | null
  orderName?: string | null
  careOrderTag?: CareOrderTagKind | string | null
  outcome?: string | null
  assignedTo?: { email?: string | null; name?: string | null } | null
  completedAt?: string | null
  updatedAt?: string | null
  status?: string | null
}

function kindFromTask(task: CareTagSourceTask): CareOrderTagKind | null {
  const raw = String(task.careOrderTag || '').trim()
  if (raw === 'care_confirmed' || raw === 'care_cancelled' || raw === 'aisensy_confirmed') {
    return raw
  }
  const outcome = String(task.outcome || '').toLowerCase()
  if (isCareConfirmedOutcome(outcome)) return 'care_confirmed'
  if (isCareCancelledOutcome(outcome)) return 'care_cancelled'
  return null
}

/** Merge confirmation tags from care tasks into the local/memory store. */
export function syncCareTagsFromCareTasks(tasks: CareTagSourceTask[]): number {
  if (!tasks?.length) return 0
  const store = loadStore()
  let added = 0
  for (const task of tasks) {
    const kind = kindFromTask(task)
    if (!kind) continue
    if (!task.orderId && !task.orderName) continue
    const before = lookupCareOrderTag(task.orderId || '', task.orderName)
    upsertTag(store, {
      orderId: task.orderId || '',
      orderName: task.orderName,
      kind,
      byEmail: task.assignedTo?.email || null,
      byName: task.assignedTo?.name || null,
      updatedAt: task.completedAt || task.updatedAt || new Date().toISOString(),
    })
    const after = lookupCareOrderTag(task.orderId || '', task.orderName)
    if (!before || before.kind !== after?.kind) added++
  }
  if (added > 0) saveStore(store)
  else memoryStore = store
  return added
}

/** Disk + in-memory care-task sync only — safe for instant list APIs. */
export function hydrateCareTagsFromLocalSources(): void {
  reloadStoreFromDisk()
  try {
    const { getCachedCareTasks } = require('@/src/services/careTasks/taskCache') as {
      getCachedCareTasks: () => CareTagSourceTask[] | null
    }
    const cached = getCachedCareTasks()
    if (cached?.length) syncCareTagsFromCareTasks(cached)
  } catch {
    // care tasks module unavailable
  }
}

/**
 * Ensure local tag cache includes Firestore care-task confirmations.
 * Safe to call on Order Status / Orders list requests.
 */
export async function ensureCareTagsHydrated(): Promise<void> {
  hydrateCareTagsFromLocalSources()

  if (Date.now() < hydrateExpiresAt) return
  if (hydrateInflight) return hydrateInflight

  hydrateInflight = (async () => {
    try {
      const admin = require('firebase-admin') as typeof import('firebase-admin')
      const { getFirebaseAdmin } = require('@/src/firebase/firebase.config') as {
        getFirebaseAdmin: () => any
      }
      const db = admin.firestore(getFirebaseAdmin())

      const byId = new Map<string, CareTagSourceTask>()
      const addDocs = (docs: Array<{ id: string; data: () => Record<string, any> }>) => {
        for (const d of docs) {
          const data = d.data() || {}
          const orderId = String(data.orderId || '')
          const key = orderId || `name:${String(data.orderName || d.id)}`
          byId.set(key, {
            orderId,
            orderName: data.orderName || null,
            careOrderTag: data.careOrderTag || null,
            outcome: data.outcome || null,
            assignedTo: data.assignedTo || null,
            completedAt: data.completedAt || null,
            updatedAt: data.updatedAt || null,
            status: data.status || null,
          })
        }
      }

      // Explicit careOrderTag field (written by confirm_cod / cancel_cod)
      try {
        const snap = await db
          .collection('careTasks')
          .where('careOrderTag', 'in', ['care_confirmed', 'care_cancelled'])
          .limit(500)
          .get()
        addDocs(snap.docs)
      } catch (e) {
        console.warn('⚠️ careOrderTag query failed:', (e as Error)?.message || e)
      }

      // Completed COD tasks — recovers tags when careOrderTag field was missing
      try {
        const snap = await db
          .collection('careTasks')
          .where('taskType', '==', 'cod_confirmation')
          .where('status', '==', 'completed')
          .limit(500)
          .get()
        addDocs(snap.docs)
      } catch (e) {
        console.warn('⚠️ completed COD tag hydrate failed:', (e as Error)?.message || e)
      }

      syncCareTagsFromCareTasks([...byId.values()])
      hydrateExpiresAt = Date.now() + HYDRATE_TTL_MS
    } catch (e) {
      console.warn('⚠️ Failed to hydrate care order tags from Firestore:', (e as Error)?.message || e)
      // Retry sooner on failure
      hydrateExpiresAt = Date.now() + 15_000
    } finally {
      hydrateInflight = null
    }
  })()

  return hydrateInflight
}

/** Overlay care tags onto order payloads for list UIs. */
export function applyCareTagsToOrders<
  T extends { id?: string | number; name?: string | null; care_tag?: CareOrderTagEntry | null },
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
    const tag = byId || byName || null
    if (!tag) return o
    return { ...o, care_tag: tag }
  })
}
