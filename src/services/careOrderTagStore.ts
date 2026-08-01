/**
 * CRM care-executive COD tags (display only — does not cancel/fulfill in Shopify).
 * Shown as small badges on Orders + Order Status lists.
 */

import fs from 'fs'
import path from 'path'
import {
  careOrderTagLabel,
  type CareOrderTagEntry,
  type CareOrderTagKind,
} from '@/src/utils/careOrderTags'

export type { CareOrderTagEntry, CareOrderTagKind }
export { careOrderTagLabel, careOrderTagTone } from '@/src/utils/careOrderTags'

const STORE_PATH = path.join(process.cwd(), '.care-order-tags.json')

type TagStore = Record<string, CareOrderTagEntry>

function loadStore(): TagStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'))
    }
  } catch {
    // corrupt — start fresh
  }
  return {}
}

function saveStore(store: TagStore) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('⚠️ Failed to persist care order tags:', e)
  }
}

function keysFor(orderId: string | number, orderName?: string | null): string[] {
  const keys = [String(orderId)]
  const clean = String(orderName || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
  if (clean) keys.push(`name:${clean}`)
  return keys
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
  const entry: CareOrderTagEntry = {
    kind: params.kind,
    label: careOrderTagLabel(params.kind),
    orderId: String(params.orderId),
    orderName: params.orderName || null,
    byEmail: params.byEmail || null,
    byName: params.byName || null,
    updatedAt: new Date().toISOString(),
  }
  for (const k of keysFor(params.orderId, params.orderName)) {
    store[k] = entry
  }
  saveStore(store)
  return entry
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
