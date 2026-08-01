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

/** Find parent + clones for an order from a flat order list. */
export function findCloneTrail(order: any, allOrders: any[]): {
  parent: any | null
  clones: any[]
  operational: any
} {
  if (!order) return { parent: null, clones: [], operational: order }

  const byClean = new Map<string, any>()
  for (const o of allOrders) {
    byClean.set(cleanOrderName(o.name), o)
  }

  let parent: any | null = null
  let parentBase: string

  if (isCloneOrderName(order.name)) {
    parentBase = getCloneParentBase(order.name) || ''
    parent = byClean.get(parentBase) || null
  } else {
    parentBase = cleanOrderName(order.name)
    parent = null
  }

  const clones = allOrders
    .filter((o) => getCloneParentBase(o.name) === parentBase)
    .sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    )

  const root = parent || (!isCloneOrderName(order.name) ? order : order)
  const operational = getOperationalOrder(root, clones)
  return { parent, clones, operational }
}
