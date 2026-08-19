/**
 * Fill missing customerName / orderId / orderName on device call rows
 * by matching phone → careTasks (preferred) → OrderRepository (fallback).
 */

import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import type { CallData } from '@/src/services/customerService'
import { loadCareTasksCached } from '@/src/services/careTasks/taskCache'
import type { CareTask } from '@/src/services/careTasks/types'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { lookupPhone, lookupPhoneByChannel } from '@/src/services/phoneStore'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'

export interface CallOrderMatch {
  customerName: string
  orderId: string
  orderName: string
}

const PREFERRED_STATUSES = new Set(['pending', 'rescheduled', 'escalated', 'unreachable'])
const INDEX_TTL_MS = 2 * 60 * 1000

type IndexedMatch = CallOrderMatch & { createdMs: number }

let orderPhoneIndex: Map<string, IndexedMatch> | null = null
let orderPhoneIndexBuiltAt = 0
let orderPhoneIndexSize = 0

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function orderCreatedMs(order: any): number {
  const raw =
    order?.created_at ||
    order?.createdAt ||
    order?.order_date ||
    order?.shiprocket_meta?.created_at ||
    ''
  const t = Date.parse(String(raw))
  return Number.isFinite(t) ? t : 0
}

function customerNameFromOrder(order: any): string {
  const first =
    order?.customer?.first_name ||
    order?.shipping_address?.first_name ||
    ''
  const last =
    order?.customer?.last_name ||
    order?.shipping_address?.last_name ||
    ''
  const joined = [first, last].filter(Boolean).join(' ').trim()
  if (joined) return joined
  return String(
    order?.customer_name ||
      order?.billing_customer_name ||
      order?.shiprocket_meta?.customer_name ||
      '',
  ).trim()
}

function phoneFromOrder(order: any): string {
  const candidates = [
    order?.customer?.phone,
    order?.shipping_address?.phone,
    order?.phone,
    order?.customer?.default_address?.phone,
    order?.billing_address?.phone,
    order?.shiprocket_meta?.customer_phone_unmasked,
    order?.shiprocket_meta?.customer_phone,
    order?.shiprocket_meta?.billing_phone,
  ]
  for (const raw of candidates) {
    const s = String(raw || '')
    if (s && s !== 'xxxxxxxxxx') {
      const key = phoneMatchKey(s)
      if (key) return key
    }
  }

  const channelId = String(order?.name || order?.shiprocket_meta?.channel_order_id || '')
    .replace(/^#/, '')
    .trim()
  const srId = order?.shiprocket_meta?.id || order?.id
  const stored = lookupPhone(srId) || lookupPhoneByChannel(channelId)
  return stored ? phoneMatchKey(stored) : ''
}

function pickBestCareTask(
  docs: { data: Record<string, any> }[],
): CallOrderMatch | null {
  if (!docs.length) return null
  const sorted = [...docs].sort((a, b) => {
    const aPref = PREFERRED_STATUSES.has(String(a.data.status || '')) ? 0 : 1
    const bPref = PREFERRED_STATUSES.has(String(b.data.status || '')) ? 0 : 1
    if (aPref !== bPref) return aPref - bPref
    return String(b.data.scheduledAt || '').localeCompare(String(a.data.scheduledAt || ''))
  })
  const best = sorted[0]?.data
  if (!best) return null
  const orderId = String(best.orderId || '')
  const orderName = String(best.orderName || '')
  const customerName = String(best.customerName || '').trim()
  if (!orderId && !orderName && !customerName) return null
  return { customerName, orderId, orderName }
}

async function loadCareTasksSnapshot(): Promise<CareTask[]> {
  return loadCareTasksCached(async () => {
    const snap = await getDb().collection('careTasks').get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as CareTask)
  }, 'full')
}

function lookupCareTasksByPhones(
  tasks: CareTask[],
  phones: string[],
): Map<string, CallOrderMatch> {
  const map = new Map<string, CallOrderMatch>()
  if (!phones.length || !tasks.length) return map

  const needed = new Set(phones)
  const byPhone = new Map<string, CareTask[]>()

  for (const task of tasks) {
    const key = phoneMatchKey(task.phone)
    if (!key || !needed.has(key)) continue
    const list = byPhone.get(key) || []
    list.push(task)
    byPhone.set(key, list)
  }

  for (const [phone, docs] of byPhone) {
    const match = pickBestCareTask(docs.map((task) => ({ data: task as unknown as Record<string, any> })))
    if (match) map.set(phone, match)
  }
  return map
}

function buildOrderPhoneIndex(orders: any[]): Map<string, IndexedMatch> {
  const index = new Map<string, IndexedMatch>()
  for (const order of orders) {
    const key = phoneFromOrder(order)
    if (!key) continue
    const createdMs = orderCreatedMs(order)
    const prev = index.get(key)
    if (prev && prev.createdMs >= createdMs) continue
    index.set(key, {
      createdMs,
      customerName: customerNameFromOrder(order),
      orderId: String(order?.id || ''),
      orderName: String(order?.name || ''),
    })
  }
  return index
}

async function getOrderPhoneIndex(): Promise<Map<string, IndexedMatch>> {
  const orders = (await OrderRepository.getCachedOrders()) || []
  const fresh =
    orderPhoneIndex &&
    Date.now() - orderPhoneIndexBuiltAt < INDEX_TTL_MS &&
    orderPhoneIndexSize === orders.length

  if (fresh && orderPhoneIndex) return orderPhoneIndex

  orderPhoneIndex = buildOrderPhoneIndex(orders)
  orderPhoneIndexBuiltAt = Date.now()
  orderPhoneIndexSize = orders.length
  return orderPhoneIndex
}

function lookupOrdersByPhones(
  phones: string[],
  index: Map<string, IndexedMatch>,
): Map<string, CallOrderMatch> {
  const map = new Map<string, CallOrderMatch>()
  for (const phone of phones) {
    const match = index.get(phone)
    if (match) {
      map.set(phone, {
        customerName: match.customerName,
        orderId: match.orderId,
        orderName: match.orderName,
      })
    }
  }
  return map
}

/** Attach CRM customer/order fields onto the given page of calls. */
export async function enrichCallsWithOrders(calls: CallData[]): Promise<CallData[]> {
  if (!calls.length) return calls

  const uniquePhones = [
    ...new Set(
      calls
        .map((c) => phoneMatchKey(c.number || c.formattedNumber))
        .filter(Boolean),
    ),
  ]

  let careMap = new Map<string, CallOrderMatch>()
  try {
    const tasks = await loadCareTasksSnapshot()
    careMap = lookupCareTasksByPhones(tasks, uniquePhones)
  } catch (err) {
    console.warn('enrichCallsWithOrders: careTasks lookup failed', err)
  }

  const missing = uniquePhones.filter((p) => !careMap.has(p))
  const orderIndex = await getOrderPhoneIndex()
  const orderMap = missing.length ? lookupOrdersByPhones(missing, orderIndex) : new Map<string, CallOrderMatch>()

  return calls.map((call) => {
    const key = phoneMatchKey(call.number || call.formattedNumber)
    if (!key) return call
    const match = careMap.get(key) || orderMap.get(key)
    if (!match) return call
    return {
      ...call,
      customerName: call.customerName || match.customerName || undefined,
      orderId: call.orderId || match.orderId || undefined,
      orderName: call.orderName || match.orderName || undefined,
    }
  })
}
