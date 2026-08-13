/** Clone / parent order name helpers (shared by Order Status + Care Tasks). */

export function cleanOrderName(name?: string | null): string {
  return String(name || '').replace(/^#/, '').trim().toLowerCase()
}

export function isCloneOrderName(name?: string | null): boolean {
  return cleanOrderName(name).endsWith('-c')
}

export function getCloneParentBase(name?: string | null): string | null {
  const clean = cleanOrderName(name)
  if (!clean.endsWith('-c')) return null
  return clean.slice(0, -2)
}

export function getLatestClone<T extends { created_at?: string }>(clones: T[]): T | null {
  if (!clones.length) return null
  return clones[clones.length - 1]
}

export function getOperationalOrder<T extends { id?: string | number; created_at?: string }>(
  order: T,
  relatedClones: T[] = [],
): T {
  return getLatestClone(relatedClones) || order
}

export type CloneOrderIndex = {
  byClean: Map<string, any>
  clonesByParent: Map<string, any[]>
}

/** Build once, reuse for many findCloneTrail calls (avoids O(n²) list scans). */
export function buildCloneOrderIndex(allOrders: any[]): CloneOrderIndex {
  const byClean = new Map<string, any>()
  const clonesByParent = new Map<string, any[]>()
  for (const o of allOrders || []) {
    const clean = cleanOrderName(o?.name)
    if (!clean) continue
    byClean.set(clean, o)
    const parentBase = getCloneParentBase(o.name)
    if (!parentBase) continue
    const list = clonesByParent.get(parentBase) || []
    list.push(o)
    clonesByParent.set(parentBase, list)
  }
  clonesByParent.forEach((list, key) => {
    list.sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    )
    clonesByParent.set(key, list)
  })
  return { byClean, clonesByParent }
}

/** Find parent + clones using a precomputed index. */
export function findCloneTrailIndexed(
  order: any,
  index: CloneOrderIndex,
): {
  parent: any | null
  clones: any[]
  operational: any
} {
  if (!order) return { parent: null, clones: [], operational: order }

  let parent: any | null = null
  let parentBase: string

  if (isCloneOrderName(order.name)) {
    parentBase = getCloneParentBase(order.name) || ''
    parent = index.byClean.get(parentBase) || null
  } else {
    parentBase = cleanOrderName(order.name)
    parent = null
  }

  const clones = index.clonesByParent.get(parentBase) || []
  const root = parent || (!isCloneOrderName(order.name) ? order : order)
  const operational = getOperationalOrder(root, clones)
  return { parent, clones, operational }
}

/** Find parent + clones for an order from a flat order list. */
export function findCloneTrail(order: any, allOrders: any[]): {
  parent: any | null
  clones: any[]
  operational: any
} {
  if (!order) return { parent: null, clones: [], operational: order }
  return findCloneTrailIndexed(order, buildCloneOrderIndex(allOrders))
}
