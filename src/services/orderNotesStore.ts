/**
 * Persistent CRM notes for orders (Shopify + Shiprocket).
 * Survives restarts; Shopify notes are also synced via the order API when possible.
 */

import fs from 'fs'
import path from 'path'

const STORE_PATH = path.join(process.cwd(), '.order-notes.json')

type NoteEntry = { note: string; updatedAt: string }
type NoteStore = Record<string, NoteEntry>

function loadStore(): NoteStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'))
    }
  } catch {
    // corrupt — start fresh
  }
  return {}
}

function saveStore(store: NoteStore) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('⚠️ Failed to persist order notes:', e)
  }
}

export function lookupNote(orderId: string | number): string {
  const entry = loadStore()[String(orderId)]
  return entry?.note || ''
}

export function storeNote(orderId: string | number, note: string) {
  const store = loadStore()
  const key = String(orderId)
  const trimmed = String(note || '').trim()
  if (!trimmed) {
    delete store[key]
  } else {
    store[key] = { note: trimmed, updatedAt: new Date().toISOString() }
  }
  saveStore(store)
}

/** Overlay CRM notes onto an order list (CRM note wins when present). */
export function applyNotesToOrders<T extends { id?: string | number; note?: string | null }>(orders: T[]): T[] {
  const store = loadStore()
  return orders.map((o) => {
    const entry = store[String(o.id)]
    if (!entry) return o
    return { ...o, note: entry.note }
  })
}
