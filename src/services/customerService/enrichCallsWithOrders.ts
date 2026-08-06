/**
 * Enrich Salestrail call rows with CRM customerName / orderId / orderName
 * by matching phone → careTasks (preferred) → OrderRepository (fallback).
 */

import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import type { CallData } from '@/src/services/customerService'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'

export interface CallOrderMatch {
  customerName: string
  orderId: string
  orderName: string
}

const PREFERRED_STATUSES = new Set(['pending', 'rescheduled', 'escalated', 'unreachable'])

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function pickBestCareTask(docs: { data: Record<string, any> }[]): CallOrderMatch | null {
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

async function lookupCareTasksByPhones(
  phones: string[],
): Promise<Map<string, CallOrderMatch>> {
  const map = new Map<string, CallOrderMatch>()
  if (!phones.length) return map

  const byPhone = new Map<string, { data: Record<string, any> }[]>()
  for (const phone of phones) byPhone.set(phone, [])

  for (const group of chunk(phones, 10)) {
    const snap = await getDb()
      .collection('careTasks')
      .where('phone', 'in', group)
      .limit(200)
      .get()
    for (const doc of snap.docs) {
      const data = doc.data() || {}
      const key = String(data.phone || '')
      if (!key || !byPhone.has(key)) continue
      byPhone.get(key)!.push({ data })
    }
  }

  for (const [phone, docs] of byPhone) {
    const match = pickBestCareTask(docs)
    if (match) map.set(phone, match)
  }
  return map
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
  return phoneMatchKey(
    order?.customer?.phone ||
      order?.shipping_address?.phone ||
      order?.phone ||
      order?.shiprocket_meta?.customer_phone ||
      '',
  )
}

function lookupOrdersByPhones(phones: string[], orders: any[]): Map<string, CallOrderMatch> {
  const map = new Map<string, CallOrderMatch>()
  if (!phones.length) return map

  const needed = new Set(phones)
  const bestByPhone = new Map<string, { match: CallOrderMatch; createdMs: number }>()

  for (const order of orders) {
    const key = phoneFromOrder(order)
    if (!key || !needed.has(key)) continue
    const createdMs = orderCreatedMs(order)
    const prev = bestByPhone.get(key)
    if (prev && prev.createdMs >= createdMs) continue
    bestByPhone.set(key, {
      createdMs,
      match: {
        customerName: customerNameFromOrder(order),
        orderId: String(order?.id || ''),
        orderName: String(order?.name || ''),
      },
    })
  }

  for (const [phone, entry] of bestByPhone) {
    map.set(phone, entry.match)
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
    careMap = await lookupCareTasksByPhones(uniquePhones)
  } catch (err) {
    console.warn('enrichCallsWithOrders: careTasks lookup failed', err)
  }

  const missing = uniquePhones.filter((p) => !careMap.has(p))
  const orders = missing.length ? (await OrderRepository.getCachedOrders()) || [] : []
  const orderMap = missing.length ? lookupOrdersByPhones(missing, orders) : new Map<string, CallOrderMatch>()

  return calls.map((call) => {
    const key = phoneMatchKey(call.number || call.formattedNumber)
    if (!key) return call
    const match = careMap.get(key) || orderMap.get(key)
    if (!match) return call
    return {
      ...call,
      customerName: match.customerName || undefined,
      orderId: match.orderId || undefined,
      orderName: match.orderName || undefined,
    }
  })
}
