export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'
import { getCachedCareTasks } from '@/src/services/careTasks/taskCache'
import {
  isOpenCareTaskStatus,
  makeManualUpsellDedupeKey,
  serializeCareTask,
} from '@/src/services/careTasks/generator'
import { getCareTaskKind } from '@/src/services/careTasks/types'
import { cleanOrderName } from '@/src/utils/cloneOrders'

async function loadOpenUpsellByOrderId(): Promise<
  Map<string, { id: string; status: string; assignedTo: any }>
> {
  const map = new Map<string, { id: string; status: string; assignedTo: any }>()

  let tasks = getCachedCareTasks() || []
  if (!tasks.length) {
    try {
      const db = admin.firestore(getFirebaseAdmin())
      const snaps = await Promise.all(
        (['pending', 'rescheduled', 'escalated'] as const).map((status) =>
          db.collection('careTasks').where('status', '==', status).get(),
        ),
      )
      tasks = snaps.flatMap((s) => s.docs.map((d) => serializeCareTask(d.id, d.data() || {})))
    } catch {
      tasks = []
    }
  }

  for (const t of tasks) {
    const isUpsell =
      t.taskType === 'upsell' ||
      getCareTaskKind(t) === 'upsell' ||
      String(t.id || '').includes('__upsell__')
    if (!isUpsell || !isOpenCareTaskStatus(t.status)) continue
    const orderId = String(t.orderId || '')
    if (!orderId || map.has(orderId)) continue
    map.set(orderId, {
      id: t.id,
      status: t.status,
      assignedTo: t.assignedTo || null,
    })
  }
  return map
}

/**
 * Paginated delivered orders for the Care Delivered Orders queue,
 * with open-upsell flags attached.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get('pageSize') || searchParams.get('per_page') || 20)),
    )
    const search = searchParams.get('search') || undefined

    const {
      applyCareTagsToOrders,
      ensureCareTagsHydrated,
    } = require('@/src/services/careOrderTagStore') as {
      applyCareTagsToOrders: (list: any[]) => any[]
      ensureCareTagsHydrated: () => Promise<void>
    }
    const {
      applyCareAssignmentsToOrders,
      ensureCareAssignmentsHydrated,
    } = require('@/src/services/careAssignmentStore') as {
      applyCareAssignmentsToOrders: (list: any[]) => any[]
      ensureCareAssignmentsHydrated: () => Promise<void>
    }

    await ensureCareTagsHydrated()
    await ensureCareAssignmentsHydrated()

    const listFilters = {
      deliveryStatus: 'delivered' as const,
      search,
      datePreset: '30days' as const,
    }
    const result = await OrderRepository.getOrderStatusPaginated(page, pageSize, listFilters)

    const upsellByOrder = await loadOpenUpsellByOrderId()
    const decorated = applyCareAssignmentsToOrders(applyCareTagsToOrders(result.orders || []))

    const orders = decorated.map((o: any) => {
      const orderId = String(o.id || '')
      const openUpsell = upsellByOrder.get(orderId) || null
      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        total_price: o.total_price,
        currency: o.currency || 'INR',
        financial_status: o.financial_status,
        payment_method: o.payment_method,
        customer: o.customer || null,
        shipping_address: o.shipping_address || null,
        care_tag: o.care_tag || null,
        care_executive: o.care_executive || null,
        fulfillments: o.fulfillments || [],
        shiprocket_meta: o.shiprocket_meta || null,
        delivered_at:
          o.shiprocket_meta?.delivered_date ||
          o.fulfillments?.[0]?.delivery_date ||
          o.fulfillments?.[0]?.updated_at ||
          null,
        hasOpenUpsell: Boolean(openUpsell),
        upsellTaskId: openUpsell?.id || makeManualUpsellDedupeKey(orderId),
        upsellStatus: openUpsell?.status || null,
        upsellAssignee: openUpsell?.assignedTo || null,
        cleanName: cleanOrderName(o.name),
      }
    })

    // Counts across the full filtered delivered set (not just this page)
    let openUpsellCount = 0
    const deliveredTotal = Number(result.total || 0)
    if (deliveredTotal > 0) {
      const forCounts =
        deliveredTotal <= pageSize
          ? { orders: result.orders || [] }
          : await OrderRepository.getOrderStatusPaginated(
              1,
              Math.min(deliveredTotal, 5000),
              listFilters,
            )
      for (const o of forCounts.orders || []) {
        if (upsellByOrder.has(String(o.id || ''))) openUpsellCount++
      }
    }
    const needsUpsellCount = Math.max(0, deliveredTotal - openUpsellCount)

    return NextResponse.json({
      orders,
      pagination: {
        page: result.page,
        pageSize: result.perPage,
        total: result.total,
        totalPages: result.totalPages,
      },
      summary: {
        delivered: deliveredTotal,
        openUpsell: openUpsellCount,
        needsUpsell: needsUpsellCount,
        orderStatus: result.summary,
      },
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to list delivered orders' },
      { status },
    )
  }
}
