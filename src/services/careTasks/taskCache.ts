import type { CareTask } from './types'

const CACHE_TTL_MS = 20_000

type CacheEntry = {
  tasks: CareTask[]
  fetchedAt: number
}

/** Org-wide enriched task list only (assignee filters are applied in memory). */
let cache: CacheEntry | null = null
let inflight: Promise<CareTask[]> | null = null

export function getCachedCareTasks(): CareTask[] | null {
  if (!cache) return null
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) return null
  return cache.tasks
}

export function setCachedCareTasks(tasks: CareTask[]): void {
  cache = { tasks, fetchedAt: Date.now() }
}

export function invalidateCareTasksCache(): void {
  cache = null
  inflight = null
}

/** Single-flight loader so list + summary share one Firestore scan. */
export async function loadCareTasksCached(
  loader: () => Promise<CareTask[]>,
): Promise<CareTask[]> {
  const hit = getCachedCareTasks()
  if (hit) return hit

  if (!inflight) {
    inflight = loader()
      .then((tasks) => {
        setCachedCareTasks(tasks)
        return tasks
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}
