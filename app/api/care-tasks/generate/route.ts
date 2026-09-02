export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { redistributeOpenTasksAmongExecutives } from '@/src/services/careTasks/assignmentEngine'
import { processOrdersForCareTasks } from '@/src/services/careTasks/generator'
import { invalidateCareTasksCache } from '@/src/services/careTasks/queries'
import { seedAdminUser } from '@/src/services/auth'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

/** Pull the newest Shopify orders and merge into the in-memory cache. */
async function refreshRecentOrdersIntoCache(limit = 50): Promise<{
  pulled: number
  cacheSize: number
}> {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    return { pulled: 0, cacheSize: ((await OrderRepository.getCachedOrders()) || []).length }
  }

  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json?limit=${Math.min(
    limit,
    250,
  )}&status=any&order=created_at+desc`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    cache: 'no-store',
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Shopify refresh failed: ${res.status} ${text}`)
  }
  let data: any = {}
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new Error('Shopify refresh returned empty or invalid JSON')
  }
  const fresh: any[] = Array.isArray(data.orders) ? data.orders : []
  const existing = (await OrderRepository.getCachedOrders()) || []
  const byId = new Map(existing.map((o: any) => [String(o.id), o]))

  for (const o of fresh) {
    const id = String(o.id)
    const prev = byId.get(id)
    // Keep Shiprocket enrichment / notes / test flags when merging
    byId.set(id, {
      ...o,
      ...(prev || {}),
      ...o,
      payment_method: prev?.payment_method || o.payment_method || null,
      shiprocket_meta: prev?.shiprocket_meta || o.shiprocket_meta || null,
      is_test_order: prev?.is_test_order === true || o.test === true,
      source: prev?.source || o.source || 'shopify',
    })
  }

  const merged = Array.from(byId.values()).sort(
    (a: any, b: any) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  )
  const ttl = OrderRepository.getCacheExpiresAt() || Date.now() + 5 * 60 * 1000
  OrderRepository.setCachedOrders(merged, Math.max(ttl, Date.now() + 60 * 1000))
  return { pulled: fresh.length, cacheSize: merged.length }
}

/**
 * Generate / backfill care tasks.
 * Always pulls the latest Shopify orders first so a newly placed COD appears immediately.
 */
export async function POST(req: NextRequest) {
  try {
    await seedAdminUser()
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const maxOrders = Number(body?.maxOrders || 200)
    const refresh = body?.refresh !== false // default true

    let pulled = 0
    if (refresh) {
      try {
        const r = await refreshRecentOrdersIntoCache(80)
        pulled = r.pulled
      } catch (err: any) {
        console.warn('care-tasks generate: Shopify refresh failed, using cache', err?.message || err)
      }
    }

    const orders = (await OrderRepository.getCachedOrders()) || []
    if (!orders.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Orders cache is empty and Shopify refresh returned nothing. Check Shopify credentials, then try again.',
        },
        { status: 409 },
      )
    }

    const redistribute = body?.redistribute === true
    let tasksRedistributed = 0

    const result = await processOrdersForCareTasks(orders, { maxOrders })

    if (redistribute) {
      tasksRedistributed = await redistributeOpenTasksAmongExecutives({
        forceEven: body?.forceEven === true,
      })
      console.log(`careTasks: redistributed ${tasksRedistributed} open tasks across executives`)
    }

    invalidateCareTasksCache()
    return NextResponse.json({
      success: true,
      cacheSize: orders.length,
      shopifyPulled: pulled,
      tasksRedistributed,
      result,
    })
  } catch (error: any) {
    const status = error?.status || 500
    console.error('care-tasks generate failed:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate care tasks' },
      { status },
    )
  }
}
