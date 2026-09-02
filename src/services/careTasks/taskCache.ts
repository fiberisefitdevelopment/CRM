import fs from 'fs'
import path from 'path'
import type { CareTask } from './types'
import { normalizeCareScheduleDay, normalizeCareTaskLabel } from './types'

/** Fresh window — serve without hitting Firestore. */
const FRESH_TTL_MS = 2 * 60 * 1000
/** Serve stale instantly while a background refresh runs. */
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DISK_PATH = path.join(process.cwd(), '.care-tasks-cache.json')

type CacheBucket = {
  tasks: CareTask[]
  fetchedAt: number
}

type BucketKey = 'active' | 'full'

const memory: Record<BucketKey, CacheBucket | null> = {
  active: null,
  full: null,
}
const inflight: Record<BucketKey, Promise<CareTask[]> | null> = {
  active: null,
  full: null,
}
let hydratedFromDisk = false

function normalizeCachedTask(task: CareTask): CareTask {
  const scheduleDay = normalizeCareScheduleDay(Number(task.scheduleDay))
  const taskLabel = normalizeCareTaskLabel(String(task.taskLabel || ''))
  if (scheduleDay === task.scheduleDay && taskLabel === task.taskLabel) return task
  return { ...task, scheduleDay, taskLabel }
}

function normalizeCachedTasks(tasks: CareTask[]): CareTask[] {
  return tasks.map(normalizeCachedTask)
}

function diskPath(key: BucketKey) {
  return key === 'full' ? DISK_PATH : path.join(process.cwd(), '.care-tasks-active-cache.json')
}

function persist(key: BucketKey, tasks: CareTask[]) {
  setImmediate(() => {
    try {
      fs.writeFileSync(
        diskPath(key),
        JSON.stringify({ savedAt: Date.now(), tasks }),
        'utf-8',
      )
    } catch (e) {
      console.warn(`⚠️ Failed to persist care-tasks ${key} disk cache:`, (e as Error)?.message || e)
    }
  })
}

function hydrateFromDisk() {
  if (hydratedFromDisk) return
  hydratedFromDisk = true
  for (const key of ['active', 'full'] as BucketKey[]) {
    try {
      const file = diskPath(key)
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const tasks = Array.isArray(raw?.tasks) ? raw.tasks : null
      const savedAt = typeof raw?.savedAt === 'number' ? raw.savedAt : 0
      if (!tasks?.length) continue
      if (Date.now() - savedAt > STALE_MAX_AGE_MS) continue
      memory[key] = { tasks: normalizeCachedTasks(tasks), fetchedAt: savedAt }
      console.log(`⚡ Hydrated ${tasks.length} care tasks (${key}) from disk`)
    } catch (e) {
      console.warn(`⚠️ Failed to hydrate care-tasks ${key} disk cache:`, (e as Error)?.message || e)
    }
  }
  // Truncated "full" snapshot is worse than none — it under-counts Assigned.
  const activeCount = memory.active?.tasks.length || 0
  const fullCount = memory.full?.tasks.length || 0
  if (fullCount > 0 && activeCount > 0 && fullCount < activeCount) {
    console.warn(
      `⚠️ Discarding truncated care-tasks full cache (${fullCount} < ${activeCount} active)`,
    )
    memory.full = null
    try {
      if (fs.existsSync(diskPath('full'))) fs.unlinkSync(diskPath('full'))
    } catch {
      // ignore
    }
  }
}

hydrateFromDisk()

/** Peek a bucket without blocking. Stale snapshots are OK. */
export function peekCachedCareTasks(key: BucketKey = 'full'): CareTask[] | null {
  return getBucket(key, true)
}

/** Fresh hit only (within FRESH_TTL). Used by callers that want "is warm?". */
export function getCachedCareTasks(): CareTask[] | null {
  hydrateFromDisk()
  // Prefer full universe when present — tag store / summary use the complete set
  const full = memory.full
  if (full && Date.now() - full.fetchedAt <= FRESH_TTL_MS) return full.tasks
  const active = memory.active
  if (active && Date.now() - active.fetchedAt <= FRESH_TTL_MS) return active.tasks
  return null
}

export function setCachedCareTasks(tasks: CareTask[]): void {
  const normalized = normalizeCachedTasks(tasks)
  memory.full = { tasks: normalized, fetchedAt: Date.now() }
  persist('full', normalized)
}

export function invalidateCareTasksCache(): void {
  // Drop cached snapshots after mutations so list views never serve stale assignees/status.
  memory.active = null
  memory.full = null
  for (const key of ['active', 'full'] as BucketKey[]) {
    try {
      const file = diskPath(key)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {
      // ignore
    }
  }
}

/** Insert/update one task in memory+disk so lists show it without a full Firestore reload. */
export function upsertCareTaskInCache(task: CareTask): void {
  if (!task?.id) return
  hydrateFromDisk()
  const normalized = normalizeCachedTask(task)
  for (const key of ['active', 'full'] as BucketKey[]) {
    const entry = memory[key]
    if (!entry?.tasks?.length) {
      // Never seed the "full" universe from a single upsert — that truncated
      // Team Performance Assigned to ~50 (24 vs 26) while thousands of tasks existed.
      if (key === 'full') continue
      if (key === 'active' && !['pending', 'rescheduled', 'escalated', 'unreachable'].includes(normalized.status)) {
        continue
      }
      memory[key] = { tasks: [normalized], fetchedAt: Date.now() }
      persist(key, memory[key]!.tasks)
      continue
    }
    const idx = entry.tasks.findIndex(
      (t) => t.id === normalized.id || (normalized.dedupeKey && t.dedupeKey === normalized.dedupeKey),
    )
    const next =
      idx >= 0
        ? entry.tasks.map((t, i) => (i === idx ? { ...t, ...normalized } : t))
        : [normalized, ...entry.tasks]
    memory[key] = { tasks: next, fetchedAt: Date.now() }
    persist(key, next)
  }
}

/** Update assignee on cached tasks for one order without dropping the whole snapshot. */
export function reassignCachedTasksForOrder(
  orderId: string,
  assignee: { userId: string; email: string; name: string },
): void {
  const id = String(orderId || '').trim()
  if (!id || !assignee?.email) return
  hydrateFromDisk()
  const now = new Date().toISOString()
  for (const key of ['active', 'full'] as BucketKey[]) {
    const entry = memory[key]
    if (!entry?.tasks?.length) continue
    let changed = false
    const next = entry.tasks.map((t) => {
      if (String(t.orderId) !== id) return t
      changed = true
      return { ...t, assignedTo: assignee, updatedAt: now }
    })
    if (!changed) continue
    memory[key] = { tasks: next, fetchedAt: entry.fetchedAt }
    persist(key, next)
  }
}

function getBucket(key: BucketKey, allowStale: boolean): CareTask[] | null {
  hydrateFromDisk()
  // One-shot remap for snapshots hydrated before D28→D23
  ensureLegacyDay28Normalized()
  const entry = memory[key]
  if (!entry?.tasks?.length) return null
  const age = Date.now() - entry.fetchedAt
  if (age <= FRESH_TTL_MS) return entry.tasks
  if (allowStale && age <= STALE_MAX_AGE_MS) return entry.tasks
  return null
}

let legacyDay28Normalized = false
function ensureLegacyDay28Normalized() {
  if (legacyDay28Normalized) return
  legacyDay28Normalized = true
  for (const key of ['active', 'full'] as BucketKey[]) {
    const entry = memory[key]
    if (!entry?.tasks?.length) continue
    memory[key] = { ...entry, tasks: normalizeCachedTasks(entry.tasks) }
  }
}

function adopt(key: BucketKey, tasks: CareTask[]) {
  memory[key] = { tasks: normalizeCachedTasks(tasks), fetchedAt: Date.now() }
  persist(key, memory[key]!.tasks)
  // Active refresh also keeps "full" usable for open-queue filters until full reloads
  if (key === 'full') {
    // no-op
  }
}

function refreshInBackground(key: BucketKey, loader: () => Promise<CareTask[]>) {
  if (inflight[key]) return
  inflight[key] = loader()
    .then((tasks) => {
      adopt(key, tasks)
      console.log(`⚡ Care tasks (${key}) snapshot refreshed: ${tasks.length}`)
      return tasks
    })
    .catch((err) => {
      console.warn(`⚠️ Care tasks (${key}) refresh failed:`, err?.message || err)
      // Keep serving existing snapshot a bit longer
      if (memory[key]?.tasks?.length) {
        memory[key] = { ...memory[key]!, fetchedAt: Date.now() - FRESH_TTL_MS + 30_000 }
      }
      throw err
    })
    .finally(() => {
      inflight[key] = null
    })
}

/**
 * Single-flight loader with stale-while-revalidate.
 * Returns memory/disk immediately when available; only blocks on true cold start.
 */
export async function loadCareTasksCached(
  loader: () => Promise<CareTask[]>,
  key: BucketKey = 'full',
): Promise<CareTask[]> {
  const fresh = getBucket(key, false)
  if (fresh) return fresh

  const stale = getBucket(key, true)
  refreshInBackground(key, loader)
  if (stale) return stale

  // Cold start — must wait once (or join in-flight)
  if (!inflight[key]) refreshInBackground(key, loader)
  return inflight[key]!
}
