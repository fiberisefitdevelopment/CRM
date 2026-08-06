import fs from 'fs'
import path from 'path'
import type { CareTask } from './types'

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
      memory[key] = { tasks, fetchedAt: savedAt }
      console.log(`⚡ Hydrated ${tasks.length} care tasks (${key}) from disk`)
    } catch (e) {
      console.warn(`⚠️ Failed to hydrate care-tasks ${key} disk cache:`, (e as Error)?.message || e)
    }
  }
}

hydrateFromDisk()

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
  memory.full = { tasks, fetchedAt: Date.now() }
  persist('full', tasks)
}

export function invalidateCareTasksCache(): void {
  // Mark stale so callers still SWR-serve memory/disk and refresh in background.
  // Clearing to null would force a cold Firestore scan on the next request.
  for (const key of ['active', 'full'] as BucketKey[]) {
    if (memory[key]?.tasks?.length) {
      memory[key] = { tasks: memory[key]!.tasks, fetchedAt: 0 }
    }
  }
}

function getBucket(key: BucketKey, allowStale: boolean): CareTask[] | null {
  hydrateFromDisk()
  const entry = memory[key]
  if (!entry?.tasks?.length) return null
  const age = Date.now() - entry.fetchedAt
  if (age <= FRESH_TTL_MS) return entry.tasks
  if (allowStale && age <= STALE_MAX_AGE_MS) return entry.tasks
  return null
}

function adopt(key: BucketKey, tasks: CareTask[]) {
  memory[key] = { tasks, fetchedAt: Date.now() }
  persist(key, tasks)
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
