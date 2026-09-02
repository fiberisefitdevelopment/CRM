import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { buildCloneOrderIndex, findCloneTrailIndexed } from '@/src/utils/cloneOrders'
import {
  isActiveRtoStatus,
  isShiprocketDeliveredStatus,
  normalizeShipmentStatus,
} from '@/src/utils/orderTimeline'
import {
  computeFollowupScheduledAt,
  createdDate,
  serializeCareTask,
} from './generator'
import { resolveCareExecutivePool } from './assignmentEngine'
import { careExecutiveDisplayName, normalizeCareExecutiveEmail } from './executiveConfig'
import { invalidateCareTasksCache, loadCareTasksCached, peekCachedCareTasks, upsertCareTaskInCache } from './taskCache'
import {
  getCareTaskKind,
  isUpsellCareTask,
  type CareOrderGroup,
  type CareTask,
  type CareTaskKind,
  type CareTaskSummary,
  type CareTaskStatus,
  type ExecutivePerformance,
} from './types'

export { invalidateCareTasksCache } from './taskCache'

let recentCarePullAt = 0
let recentCareInflight: Promise<CareTask[]> | null = null

/** Newest care tasks from Firestore — cheap complement to the 2-minute SWR snapshot. */
async function pullRecentCareTasks(): Promise<CareTask[]> {
  const now = Date.now()
  if (now - recentCarePullAt < 2_000 && !recentCareInflight) {
    return []
  }
  if (recentCareInflight) return recentCareInflight

  recentCareInflight = (async () => {
    const col = getDb().collection('careTasks')
    let snap: admin.firestore.QuerySnapshot | null = null
    try {
      snap = await col.orderBy('createdAt', 'desc').limit(40).get()
    } catch {
      try {
        snap = await col.orderBy('createdAtTs', 'desc').limit(40).get()
      } catch {
        snap = null
      }
    }
    recentCarePullAt = Date.now()
    if (!snap || snap.empty) return []
    const tasks = snap.docs.map((d) => serializeCareTask(d.id, d.data()))
    for (const t of tasks) {
      try {
        upsertCareTaskInCache(t)
      } catch {
        // ignore
      }
    }
    return tasks
  })()
    .catch((err) => {
      console.warn('careTasks: recent pull failed', err?.message || err)
      return [] as CareTask[]
    })
    .finally(() => {
      recentCareInflight = null
    })

  return recentCareInflight
}

function unionTasks(base: CareTask[], extra: CareTask[]): CareTask[] {
  if (!extra.length) return base
  const map = new Map(base.map((t) => [t.id, t]))
  for (const t of extra) {
    if (!map.has(t.id)) map.set(t.id, t)
    else map.set(t.id, { ...map.get(t.id)!, ...t })
  }
  return [...map.values()]
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfTodayIso(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function isOverdue(task: CareTask): boolean {
  if (task.status !== 'pending' && task.status !== 'rescheduled') return false
  return Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() < Date.now())
}

/** Numeric order id from `#2821` / `2821-C` — higher = more recently placed. */
function orderNumber(task: CareTask): number {
  const m = String(task.orderName || task.orderId || '').match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

/** Newest placed orders first (order created date, then order number). */
function taskRecencyTs(task: CareTask): number {
  const raw = task.orderCreatedAt || ''
  const n = new Date(raw).getTime()
  if (Number.isFinite(n) && n > 0) return n
  // COD confirmation scheduledAt == order created; avoid future follow-up dates
  if (getCareTaskKind(task) === 'cod_confirmation' && task.scheduledAt) {
    const s = new Date(task.scheduledAt).getTime()
    if (Number.isFinite(s) && s > 0) return s
  }
  return orderNumber(task)
}

function kindRank(task: CareTask): number {
  // COD confirmation always floats to the top of mixed lists
  if (getCareTaskKind(task) === 'cod_confirmation') return 0
  return 1
}

function sortByRecentOrder(tasks: CareTask[]): CareTask[] {
  return [...tasks].sort((a, b) => {
    const kr = kindRank(a) - kindRank(b)
    if (kr !== 0) return kr
    const dt = taskRecencyTs(b) - taskRecencyTs(a)
    if (dt !== 0) return dt
    return orderNumber(b) - orderNumber(a)
  })
}

export type CarePageSize = 20 | 50 | 100

export interface ListCareTasksParams {
  status?: CareTaskStatus | 'all' | 'overdue' | 'today' | 'upcoming' | 'inbox'
  kind?: CareTaskKind | 'all'
  /** Optional filter — when set, only that assignee’s tasks. Care executives are always scoped to self. */
  assigneeEmail?: string | null
  /** @deprecated ignored — list is always org-wide unless assigneeEmail is set */
  includeUnassigned?: boolean
  search?: string
  /** @deprecated use page + pageSize */
  limit?: number
  page?: number
  pageSize?: CarePageSize | number
  /** Optional list sort (defaults to recent-order / rescheduled due asc). */
  sort?: 'due_asc' | 'due_desc' | 'created_desc' | 'priority' | 'name_asc' | 'recent'
  /** When true, keep only tasks whose linked order is currently delivered. */
  deliveredOnly?: boolean
  /** Filter upsell/day-based tasks by schedule day (5 / 28 / 90 / manual). */
  day?: 'all' | '5' | '23' | '28' | '90' | 'manual'
  /** Filter by mapped pack / product (7 starter, 30 transformation, 90 ultimate). */
  pack?: 'all' | '7' | '30' | '90'
  /** One row per Shopify order, with the full call journey nested. */
  groupBy?: 'task' | 'order'
}

export interface ListCareTasksResult {
  tasks: CareTask[]
  groups?: CareOrderGroup[]
  total: number
  page: number
  pageSize: number
  kindCounts: Record<string, number>
}

function normalizePageSize(value?: number): CarePageSize {
  if (value === 50 || value === 100) return value
  return 20
}

function enrichOrderCreatedAt(tasks: CareTask[], orders: any[]): CareTask[] {
  if (!orders.length) return tasks
  const byId = new Map(orders.map((o: any) => [String(o.id), o]))
  const byName = new Map(
    orders.map((o: any) => [String(o.name || '').replace(/^#/, '').toLowerCase(), o]),
  )
  const cloneIndex = buildCloneOrderIndex(orders)
  return tasks.map((t) => {
    const nameKey = String(t.orderName || '')
      .replace(/^#/, '')
      .toLowerCase()
    const order = byId.get(String(t.orderId)) || byName.get(nameKey) || null
    const orderCreatedAt = order?.created_at || t.orderCreatedAt || null
    let scheduledAt = t.scheduledAt

    // Repair follow-up due dates corrupted by DD-MM vs MM-DD delivery parse
    // Never clobber intentional Call After / Reschedule / Unreachable times.
    if (order && typeof t.scheduleDay === 'number' && t.scheduleDay >= 0) {
      const intentionallyRescheduled =
        t.status === 'rescheduled' ||
        Boolean(t.lastUnreachableAt) ||
        Boolean(t.rescheduledAt)
      if (!intentionallyRescheduled) {
        const { operational } = findCloneTrailIndexed(order, cloneIndex)
        const live = operational || order
        if (isShiprocketDeliveredStatus(live)) {
          const corrected = computeFollowupScheduledAt(live, t.scheduleDay)
          const oldTs = new Date(t.scheduledAt || 0).getTime()
          const newTs = new Date(corrected).getTime()
          const createdTs = new Date(orderCreatedAt || 0).getTime()
          const clearlyWrong =
            Number.isFinite(oldTs) &&
            Number.isFinite(newTs) &&
            (Math.abs(oldTs - newTs) > 12 * 3600 * 1000 ||
              (Number.isFinite(createdTs) && oldTs < createdTs - 24 * 3600 * 1000))
          if (clearlyWrong) scheduledAt = corrected
        }
      }
    } else if (order && getCareTaskKind(t) === 'cod_confirmation') {
      // COD due defaults to order created — but never clobber Call After / Unreachable reschedules.
      const corrected = createdDate(order).toISOString()
      const oldTs = new Date(t.scheduledAt || 0).getTime()
      const newTs = new Date(corrected).getTime()
      const intentionallyRescheduled =
        t.status === 'rescheduled' || Boolean(t.lastUnreachableAt) || (Number.isFinite(oldTs) && oldTs > newTs + 60 * 60 * 1000)
      if (
        !intentionallyRescheduled &&
        Number.isFinite(oldTs) &&
        Number.isFinite(newTs) &&
        // Only repair parse bugs (stored due far *before* order created), not future Call After times
        oldTs < newTs - 12 * 3600 * 1000
      ) {
        scheduledAt = corrected
      }
    }

    return orderCreatedAt === t.orderCreatedAt && scheduledAt === t.scheduledAt
      ? t
      : { ...t, orderCreatedAt, scheduledAt }
  })
}

function resolveTaskOrder(
  task: CareTask,
  byId: Map<string, any>,
  byName: Map<string, any>,
): any | null {
  const nameKey = String(task.orderName || '')
    .replace(/^#/, '')
    .toLowerCase()
  return byId.get(String(task.orderId)) || byName.get(nameKey) || null
}

function orderLookupMaps(orders: any[]): { byId: Map<string, any>; byName: Map<string, any> } {
  const byId = new Map(orders.map((o: any) => [String(o.id), o]))
  const byName = new Map(
    orders.map((o: any) => [String(o.name || '').replace(/^#/, '').toLowerCase(), o]),
  )
  return { byId, byName }
}

/**
 * COD confirmation is only relevant pre-delivery.
 * Hide those tasks once the order (or its live clone) is delivered.
 */
function excludeDeliveredCodConfirmations(
  tasks: CareTask[],
  orders: any[],
  index = buildCloneOrderIndex(orders),
  lookups?: { byId: Map<string, any>; byName: Map<string, any> },
): CareTask[] {
  if (!orders.length) return tasks
  const { byId, byName } = lookups || orderLookupMaps(orders)

  return tasks.filter((t) => {
    if (getCareTaskKind(t) !== 'cod_confirmation') return true
    const order = resolveTaskOrder(t, byId, byName)
    if (!order) return true
    const { operational } = findCloneTrailIndexed(order, index)
    return !isShiprocketDeliveredStatus(operational || order)
  })
}

function isCareOrderCancelled(order: any): boolean {
  if (!order) return false
  if (order.cancelled_at) return true
  const financial = String(order.financial_status || '').toLowerCase()
  if (financial === 'voided' || financial === 'cancelled') return true
  return normalizeShipmentStatus(order) === 'cancelled'
}

function isCareOrderRto(order: any): boolean {
  if (!order) return false
  if (isActiveRtoStatus(order)) return true
  const status = normalizeShipmentStatus(order)
  return status === 'rto' || status === 'rto_delivered'
}

/**
 * Hide open care work for cancelled / RTO Initiated / RTO Delivered orders
 * (still keep completed history).
 */
function excludeNonActionableOrderTasks(
  tasks: CareTask[],
  orders: any[],
  index = buildCloneOrderIndex(orders),
  lookups?: { byId: Map<string, any>; byName: Map<string, any> },
): CareTask[] {
  if (!orders.length) return tasks
  const { byId, byName } = lookups || orderLookupMaps(orders)

  return tasks.filter((t) => {
    if (t.status === 'completed') return true
    const order = resolveTaskOrder(t, byId, byName)
    if (!order) return true
    const { operational } = findCloneTrailIndexed(order, index)
    const live = operational || order
    return !isCareOrderCancelled(live) && !isCareOrderRto(live)
  })
}

/** Page through the whole careTasks collection — same source for admin and executives. */
async function fetchAllTaskDocs(): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const col = getDb().collection('careTasks')
  const all: admin.firestore.QueryDocumentSnapshot[] = []
  const pageSize = 500
  const maxDocs = 8000

  async function pageBy(field: string) {
    all.length = 0
    let last: admin.firestore.QueryDocumentSnapshot | undefined
    while (all.length < maxDocs) {
      let q: admin.firestore.Query = col.orderBy(field, 'desc').limit(pageSize)
      if (last) q = q.startAfter(last)
      const snap = await q.get()
      if (snap.empty) break
      all.push(...snap.docs)
      last = snap.docs[snap.docs.length - 1]
      if (snap.size < pageSize) break
    }
  }

  try {
    await pageBy('createdAt')
    if (all.length) return all
  } catch {
    // index / field missing
  }

  try {
    await pageBy('scheduledAt')
    if (all.length) return all
  } catch {
    // ignore
  }

  // Last resort: unordered chunks
  all.length = 0
  let snap = await col.limit(pageSize).get()
  while (!snap.empty && all.length < maxDocs) {
    all.push(...snap.docs)
    const last = snap.docs[snap.docs.length - 1]
    snap = await col.startAfter(last).limit(pageSize).get()
  }
  return all
}

/** Active work queue only — much smaller than the full history. */
async function fetchActiveTaskDocs(): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  try {
    const statuses = ['pending', 'rescheduled', 'escalated', 'unreachable'] as const
    const snaps = await Promise.all(
      statuses.map((status) =>
        getDb().collection('careTasks').where('status', '==', status).get(),
      ),
    )
    return snaps.flatMap((snap) => snap.docs)
  } catch {
    // Fallback if queries fail
    return fetchAllTaskDocs()
  }
}

function needsFullHistory(params: ListCareTasksParams): boolean {
  const s = params.status
  return !s || s === 'all' || s === 'completed' || s === 'unreachable' || s === 'not_interested'
}

async function docsToEnrichedTasks(
  docs: admin.firestore.QueryDocumentSnapshot[],
): Promise<CareTask[]> {
  const rawTasks = docs.map((d) => serializeCareTask(d.id, d.data()))
  try {
    const { syncCareTagsFromCareTasks } = require('@/src/services/careOrderTagStore') as {
      syncCareTagsFromCareTasks: (tasks: CareTask[]) => number
    }
    syncCareTagsFromCareTasks(rawTasks)
  } catch {
    // tag store unavailable
  }
  const orders = (await OrderRepository.getCachedOrders()) || []
  const enriched = enrichOrderCreatedAt(rawTasks, orders)
  persistScheduledAtRepairs(rawTasks, enriched)
  const promoted = promoteDueReschedules(enriched)
  const cloneIndex = buildCloneOrderIndex(orders)
  const lookups = orderLookupMaps(orders)
  return excludeNonActionableOrderTasks(
    excludeDeliveredCodConfirmations(promoted, orders, cloneIndex, lookups),
    orders,
    cloneIndex,
    lookups,
  )
}

/** When Call After time arrives, move task back to To do (pending). Unreachable stays put. */
function promoteDueReschedules(tasks: CareTask[]): CareTask[] {
  const now = Date.now()
  const dueIds: string[] = []
  const next = tasks.map((t) => {
    if (t.status !== 'rescheduled') return t
    if (t.lastUnreachableAt) {
      return { ...t, status: 'unreachable' as const }
    }
    const due = new Date(t.scheduledAt).getTime()
    if (!Number.isFinite(due) || due > now) return t
    dueIds.push(t.id)
    return { ...t, status: 'pending' as const }
  })
  const parkedUnreachable = next
    .filter((t) => t.status === 'unreachable' && t.lastUnreachableAt)
    .map((t) => t.id)
    .filter((id) => tasks.find((x) => x.id === id && x.status === 'rescheduled'))
  if (parkedUnreachable.length) persistParkUnreachable(parkedUnreachable)
  if (dueIds.length) persistPromoteDueReschedules(dueIds)
  return next
}

function persistParkUnreachable(ids: string[]): void {
  void (async () => {
    try {
      const db = getDb()
      const chunk = ids.slice(0, 200)
      const batch = db.batch()
      const now = new Date().toISOString()
      for (const id of chunk) {
        batch.update(db.collection('careTasks').doc(id), {
          status: 'unreachable',
          updatedAt: now,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await batch.commit()
      invalidateCareTasksCache()
    } catch (err) {
      console.warn('careTasks: park unreachable failed', err)
    }
  })()
}

function persistPromoteDueReschedules(ids: string[]): void {
  void (async () => {
    try {
      const db = getDb()
      const chunk = ids.slice(0, 200)
      const batch = db.batch()
      const now = new Date().toISOString()
      for (const id of chunk) {
        batch.update(db.collection('careTasks').doc(id), {
          status: 'pending',
          updatedAt: now,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await batch.commit()
      invalidateCareTasksCache()
      console.log(`careTasks: promoted ${chunk.length} due reschedules back to To do`)
    } catch (err) {
      console.warn('careTasks: promote due reschedules failed', err)
    }
  })()
}

/** Org-wide enriched tasks (SWR + disk, single-flight). */
async function loadOrgTasks(): Promise<CareTask[]> {
  return loadCareTasksCached(async () => {
    const docs = await fetchAllTaskDocs()
    return docsToEnrichedTasks(docs)
  }, 'full')
}

/** Open-queue only — pending / rescheduled / escalated (SWR + disk, single-flight). */
async function loadActiveTasks(): Promise<CareTask[]> {
  const tasks = await loadCareTasksCached(async () => {
    const docs = await fetchActiveTaskDocs()
    return docsToEnrichedTasks(docs)
  }, 'active')
  // Warm full universe in background so summary/performance are instant next
  void loadOrgTasks().catch(() => {})
  return tasks
}

async function resolveTaskUniverse(params: ListCareTasksParams): Promise<CareTask[]> {
  const [tasks, recent] = await Promise.all([
    needsFullHistory(params) ? loadOrgTasks() : loadActiveTasks(),
    pullRecentCareTasks(),
  ])
  const merged = unionTasks(tasks, recent)
  if (params.assigneeEmail) {
    const email = params.assigneeEmail.toLowerCase()
    return merged.filter(
      (t) => normalizeCareExecutiveEmail(t.assignedTo?.email) === email,
    )
  }
  return merged
}

function filterTasksClient(
  tasks: CareTask[],
  params: ListCareTasksParams,
  opts?: { ignoreKind?: boolean },
): CareTask[] {
  let list = tasks
  const todayStart = new Date(startOfTodayIso()).getTime()
  const todayEnd = new Date(endOfTodayIso()).getTime()

  if (!opts?.ignoreKind && params.kind && params.kind !== 'all') {
    const kind =
      params.kind === 'day_28' ? 'day_23' : params.kind
    list = list.filter((t) =>
      kind === 'upsell'
        ? isUpsellCareTask(t)
        : getCareTaskKind(t) === kind,
    )
  }

  if (params.day && params.day !== 'all') {
    if (params.day === 'manual') {
      list = list.filter(
        (t) =>
          t.scheduleDay === -2 ||
          t.source === 'manual' ||
          String(t.id || '').includes('__upsell__manual'),
      )
    } else {
      const dayNum = Number(params.day) === 28 ? 23 : Number(params.day)
      list = list.filter((t) => {
        const d = Number(t.scheduleDay)
        // Legacy Transformation upsell was D28; treat as D23
        if (dayNum === 23) return d === 23 || d === 28
        return d === dayNum
      })
    }
  }

  if (params.pack && params.pack !== 'all') {
    const packKey = String(params.pack)
    list = list.filter((t) => {
      if (String(t.packKey || '') === packKey) return true
      const hay = `${t.packLabel || ''} ${t.taskLabel || ''}`.toLowerCase()
      if (packKey === '7') return hay.includes('starter')
      if (packKey === '30') return hay.includes('transformation')
      if (packKey === '90') return hay.includes('ultimate')
      return false
    })
  }

  if (params.status && params.status !== 'all') {
    if (params.status === 'overdue') {
      // Overdue open work only — rescheduled live in their own tab
      list = list.filter((t) => t.status === 'pending' && isOverdue(t))
    } else if (params.status === 'today') {
      list = list.filter((t) => {
        const ts = new Date(t.scheduledAt).getTime()
        return t.status === 'pending' && ts >= todayStart && ts <= todayEnd
      })
    } else if (params.status === 'upcoming') {
      list = list.filter(
        (t) =>
          t.status === 'pending' && new Date(t.scheduledAt).getTime() > todayEnd,
      )
    } else if (params.status === 'inbox') {
      // Open queue only — Call After / escalations live in their own tabs
      list = list.filter((t) => t.status === 'pending')
    } else if (params.status === 'rescheduled') {
      // Future Call After only — due ones are promoted back to To do
      const now = Date.now()
      list = list.filter(
        (t) =>
          t.status === 'rescheduled' &&
          !t.lastUnreachableAt &&
          Number.isFinite(new Date(t.scheduledAt).getTime()) &&
          new Date(t.scheduledAt).getTime() > now,
      )
    } else if (params.status === 'unreachable') {
      list = list.filter((t) => t.status === 'unreachable')
    } else if (params.status === 'escalated') {
      list = list.filter((t) => t.status === 'escalated')
    } else if (params.status === 'not_interested') {
      list = list.filter((t) => t.status === 'not_interested')
    } else {
      list = list.filter((t) => t.status === params.status)
    }
  }

  if (params.search) {
    const q = params.search.toLowerCase().trim()
    list = list.filter(
      (t) =>
        t.customerName.toLowerCase().includes(q) ||
        t.orderName.toLowerCase().includes(q) ||
        t.orderId.includes(q) ||
        t.phone.includes(q) ||
        t.taskLabel.toLowerCase().includes(q),
    )
  }

  return list
}

/** Persist corrected due dates (DD-MM misparse repairs) without blocking the response. */
function persistScheduledAtRepairs(
  original: CareTask[],
  repaired: CareTask[],
): void {
  const byId = new Map(original.map((t) => [t.id, t]))
  const updates: Array<{ id: string; scheduledAt: string; orderCreatedAt?: string | null }> = []
  for (const t of repaired) {
    const prev = byId.get(t.id)
    if (!prev) continue
    if (prev.scheduledAt === t.scheduledAt) continue
    if (['completed', 'not_interested'].includes(t.status)) continue
    // Never persist a "repair" over a user Call After / Reschedule
    if (
      t.status === 'rescheduled' ||
      prev.status === 'rescheduled' ||
      t.rescheduledAt ||
      prev.rescheduledAt ||
      t.lastUnreachableAt ||
      prev.lastUnreachableAt
    ) {
      continue
    }
    updates.push({
      id: t.id,
      scheduledAt: t.scheduledAt,
      orderCreatedAt: t.orderCreatedAt,
    })
  }
  if (!updates.length) return

  void (async () => {
    try {
      const db = getDb()
      const chunk = updates.slice(0, 200)
      const batch = db.batch()
      const now = new Date().toISOString()
      for (const u of chunk) {
        batch.update(db.collection('careTasks').doc(u.id), {
          scheduledAt: u.scheduledAt,
          ...(u.orderCreatedAt ? { orderCreatedAt: u.orderCreatedAt } : {}),
          updatedAt: now,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await batch.commit()
      console.log(`careTasks: repaired scheduledAt on ${chunk.length} tasks`)
    } catch (err) {
      console.warn('careTasks: scheduledAt repair batch failed', err)
    }
  })()
}

function orderGroupKey(t: CareTask): string {
  return String(t.orderId || '').trim() || String(t.orderName || '').trim() || t.id
}

function sortCallJourney(list: CareTask[]): CareTask[] {
  return [...list].sort((a, b) => {
    const da = Number(a.scheduleDay)
    const db = Number(b.scheduleDay)
    const sa = Number.isFinite(da) ? da : 999
    const sb = Number.isFinite(db) ? db : 999
    if (sa !== sb) return sa - sb
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  })
}

async function paginateByOrder(
  matching: CareTask[],
  opts: { page: number; pageSize: number; wantAll: boolean },
): Promise<Pick<ListCareTasksResult, 'tasks' | 'groups' | 'total' | 'page' | 'pageSize'>> {
  const keyOrder: string[] = []
  const seen = new Set<string>()
  const focusByKey = new Map<string, CareTask>()
  for (const t of matching) {
    const k = orderGroupKey(t)
    if (!seen.has(k)) {
      seen.add(k)
      keyOrder.push(k)
      focusByKey.set(k, t)
    }
  }

  const total = keyOrder.length
  const pageSize = opts.pageSize
  let safePage = 1
  let pageKeys = keyOrder
  if (!opts.wantAll) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
    safePage = Math.min(Math.max(1, opts.page), totalPages)
    const start = (safePage - 1) * pageSize
    pageKeys = keyOrder.slice(start, start + pageSize)
  }

  const pageKeySet = new Set(pageKeys)
  let pool: CareTask[] = matching
  try {
    pool = await loadOrgTasks()
  } catch {
    pool = matching
  }

  const byKey = new Map<string, CareTask[]>()
  for (const t of pool) {
    const k = orderGroupKey(t)
    if (!pageKeySet.has(k)) continue
    const arr = byKey.get(k) || []
    arr.push(t)
    byKey.set(k, arr)
  }
  for (const t of matching) {
    const k = orderGroupKey(t)
    if (!pageKeySet.has(k)) continue
    const arr = byKey.get(k) || []
    if (!arr.some((x) => x.id === t.id)) arr.push(t)
    byKey.set(k, arr)
  }

  const groups: CareOrderGroup[] = pageKeys.map((k) => {
    const groupTasks = sortCallJourney(byKey.get(k) || [])
    const focus =
      focusByKey.get(k) ||
      groupTasks.find((t) => t.status === 'pending' || t.status === 'rescheduled') ||
      groupTasks[0]
    const head = focus || groupTasks[0]
    return {
      key: k,
      orderId: head?.orderId || k,
      orderName: head?.orderName || '',
      customerName: head?.customerName || '',
      phone: head?.phone || '',
      packKey: head?.packKey || '',
      packLabel: head?.packLabel,
      orderCreatedAt: head?.orderCreatedAt || null,
      paymentMethod: head?.paymentMethod || 'unknown',
      assignedTo: head?.assignedTo || null,
      tasks: groupTasks,
      focusTaskId: focus?.id || groupTasks[0]?.id || '',
    }
  })

  return {
    tasks: groups.flatMap((g) => g.tasks),
    groups,
    total,
    page: safePage,
    pageSize: opts.wantAll ? total || pageSize : pageSize,
  }
}

export async function listCareTasks(params: ListCareTasksParams = {}): Promise<ListCareTasksResult> {
  const pageSize = normalizePageSize(
    params.pageSize ||
      (params.limit && params.limit <= 20
        ? 20
        : params.limit && params.limit <= 50
          ? 50
          : params.limit && params.limit <= 100
            ? 100
            : 20),
  )
  // Legacy callers that passed limit:500 for summaries — treat as “all pages”
  const wantAll =
    typeof params.limit === 'number' &&
    params.limit >= 500 &&
    params.pageSize == null &&
    params.page == null
  const page = Math.max(1, Number(params.page || 1))

  const tasks = await resolveTaskUniverse(params)

  const statusFiltered = filterTasksClient(tasks, params, { ignoreKind: true })
  const kindCounts: Record<string, number> = {}
  for (const t of statusFiltered) {
    const k = getCareTaskKind(t)
    kindCounts[k] = (kindCounts[k] || 0) + 1
  }

  const resolvedKind =
    params.kind === 'day_28' ? 'day_23' : params.kind
  const matchesKind = (t: CareTask) =>
    resolvedKind === 'upsell'
      ? isUpsellCareTask(t)
      : getCareTaskKind(t) === resolvedKind

  const filteredBase =
    params.status === 'rescheduled'
      ? [...(resolvedKind && resolvedKind !== 'all'
          ? statusFiltered.filter(matchesKind)
          : statusFiltered)]
      : resolvedKind && resolvedKind !== 'all'
        ? statusFiltered.filter(matchesKind)
        : statusFiltered

  let filteredForSort = filteredBase
  if (params.deliveredOnly) {
    const orders = (await OrderRepository.getCachedOrders()) || []
    const index = buildCloneOrderIndex(orders)
    const byId = new Map(orders.map((o: any) => [String(o.id), o]))
    const byName = new Map(
      orders.map((o: any) => [String(o.name || '').replace(/^#/, '').toLowerCase(), o]),
    )
    filteredForSort = filteredBase.filter((t) => {
      const nameKey = String(t.orderName || '')
        .replace(/^#/, '')
        .toLowerCase()
      const order = byId.get(String(t.orderId)) || byName.get(nameKey) || null
      if (!order) return false
      const { operational } = findCloneTrailIndexed(order, index)
      const live = operational || order
      if (!isShiprocketDeliveredStatus(live)) return false

      const isManualUpsell =
        t.source === 'manual' ||
        String(t.id || '').includes('__upsell__manual') ||
        t.scheduleDay === -2
      if (isManualUpsell) return true

      return Boolean(
        live?.shiprocket_meta?.delivered_date ||
          live?.shiprocket_meta?.delivery_date ||
          live?.fulfillments?.[0]?.delivery_date,
      )
    })
  }

  const filtered = (() => {
    const sort = params.sort || (params.status === 'rescheduled' ? 'due_asc' : 'recent')
    if (sort === 'recent') return sortByRecentOrder(filteredForSort)
    const pri = (p?: string) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)
    return [...filteredForSort].sort((a, b) => {
      switch (sort) {
        case 'due_desc':
          return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
        case 'created_desc':
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        case 'priority': {
          const d = pri(a.priority) - pri(b.priority)
          if (d !== 0) return d
          return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        }
        case 'name_asc':
          return String(a.orderName || '').localeCompare(String(b.orderName || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        case 'due_asc':
        default:
          return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      }
    })
  })()

  const total = filtered.length
  if (params.groupBy === 'order') {
    const grouped = await paginateByOrder(filtered, { page, pageSize, wantAll })
    return { ...grouped, kindCounts }
  }

  if (wantAll) {
    return { tasks: filtered, total, page: 1, pageSize: total || pageSize, kindCounts }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize

  return {
    tasks: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    kindCounts,
  }
}

export async function getCareTaskById(id: string): Promise<CareTask | null> {
  const snap = await getDb().collection('careTasks').doc(id).get()
  if (!snap.exists) return null
  const orders = (await OrderRepository.getCachedOrders()) || []
  const [task] = promoteDueReschedules(
    enrichOrderCreatedAt([serializeCareTask(snap.id, snap.data() || {})], orders),
  )
  return task
}

/** Org-wide summary — same numbers for admin and care executives. */
export async function summarizeCareTasks(assigneeEmail?: string | null): Promise<CareTaskSummary> {
  // Open-queue counts from active universe — never block first paint on full history.
  const [active, recent] = await Promise.all([loadActiveTasks(), pullRecentCareTasks()])
  let tasks = unionTasks(active, recent)
  if (assigneeEmail) {
    const email = assigneeEmail.toLowerCase()
    tasks = tasks.filter(
      (t) => normalizeCareExecutiveEmail(t.assignedTo?.email) === email,
    )
  }
  const todayStart = new Date(startOfTodayIso()).getTime()
  const todayEnd = new Date(endOfTodayIso()).getTime()

  const summary: CareTaskSummary = {
    total: tasks.length,
    pending: 0,
    completed: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    missed: 0,
    escalated: 0,
    rescheduled: 0,
    unreachable: 0,
    notInterested: 0,
  }

  for (const t of tasks) {
    if (t.status === 'completed') summary.completed += 1
    if (t.status === 'pending') summary.pending += 1
    if (t.status === 'rescheduled') {
      const due = new Date(t.scheduledAt).getTime()
      // Due reschedules are treated as To do after promote; count only still-waiting ones
      if (Number.isFinite(due) && due > Date.now()) summary.rescheduled += 1
      else summary.pending += 1
    }
    if (t.status === 'escalated') summary.escalated += 1
    if (t.status === 'unreachable') summary.unreachable += 1
    if (t.status === 'not_interested') summary.notInterested += 1
    if (t.status === 'pending' && isOverdue(t)) {
      summary.overdue += 1
      summary.missed += 1
    }
    const ts = new Date(t.scheduledAt).getTime()
    if (t.status === 'pending' && ts >= todayStart && ts <= todayEnd) {
      summary.today += 1
    }
    if (t.status === 'pending' && ts > todayEnd) {
      summary.upcoming += 1
    }
  }

  // History totals from a warm full snapshot only — never wait on Firestore.
  const full = peekCachedCareTasks('full')
  if (full?.length) {
    let completed = 0
    let notInterested = 0
    let unreachable = 0
    let total = 0
    const email = assigneeEmail?.toLowerCase()
    for (const t of full) {
      if (
        email &&
        normalizeCareExecutiveEmail(t.assignedTo?.email) !== email
      ) {
        continue
      }
      total += 1
      if (t.status === 'completed') completed += 1
      if (t.status === 'not_interested') notInterested += 1
      if (t.status === 'unreachable') unreachable += 1
    }
    summary.total = total
    summary.completed = completed
    summary.notInterested = notInterested
    summary.unreachable = unreachable
  }

  return summary
}

export async function getExecutivePerformance(): Promise<ExecutivePerformance[]> {
  const tasks = await loadOrgTasks()
  const byEmail = new Map<string, CareTask[]>()

  for (const t of tasks) {
    const email = t.assignedTo?.email || 'unassigned'
    if (!byEmail.has(email)) byEmail.set(email, [])
    byEmail.get(email)!.push(t)
  }

  const pool = await resolveCareExecutivePool()
  const poolByEmail = new Map(pool.map((e) => [e.email, e]))
  const emails = new Set<string>([
    ...pool.map((e) => e.email),
    ...byEmail.keys(),
  ])
  emails.delete('unassigned')

  const rows: ExecutivePerformance[] = []
  for (const email of emails) {
    const list = byEmail.get(email) || []
    const poolExec = poolByEmail.get(email)
    const completed = list.filter((t) => t.status === 'completed')
    const pending = list.filter(
      (t) => t.status === 'pending' || t.status === 'rescheduled' || t.status === 'escalated',
    )
    const overdue = list.filter(isOverdue)
    const callsMade = list.reduce((n, t) => n + (t.calls?.length || 0), 0)

    let avgCompletionHours: number | null = null
    const durations: number[] = []
    for (const t of completed) {
      if (!t.completedAt || !t.createdAt) continue
      const ms = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()
      if (ms > 0) durations.push(ms / 3600000)
    }
    if (durations.length) {
      avgCompletionHours = durations.reduce((a, b) => a + b, 0) / durations.length
    }

    const lastActivity =
      list
        .map((t) => t.updatedAt || t.completedAt || t.createdAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null

    rows.push({
      email,
      name: careExecutiveDisplayName(email, list[0]?.assignedTo?.name || poolExec?.name),
      assigned: list.length,
      completed: completed.length,
      pending: pending.length,
      overdue: overdue.length,
      callsMade,
      avgCompletionHours,
      completionPct: list.length ? Math.round((completed.length / list.length) * 100) : 0,
      lastActivity,
    })
  }

  return rows.sort((a, b) => {
    const order = (email: string) => {
      const idx = pool.findIndex((e) => e.email === email)
      return idx >= 0 ? idx : 99
    }
    const oa = order(a.email)
    const ob = order(b.email)
    if (oa !== ob) return oa - ob
    return b.assigned - a.assigned
  })
}
