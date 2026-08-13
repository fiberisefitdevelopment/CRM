export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  canAccessCareTasksApi,
  requireSession,
  resolveCareTaskAssigneeFilter,
} from '@/src/services/careTasks/session'
import { getCachedCareTasks } from '@/src/services/careTasks/taskCache'
import {
  isOpenCareTaskStatus,
  makeManualUpsellDedupeKey,
} from '@/src/services/careTasks/generator'
import {
  CARE_EXECUTIVE_EMAILS,
  normalizeCareExecutiveEmail,
} from '@/src/services/careTasks/executiveConfig'
import { getCareTaskKind } from '@/src/services/careTasks/types'
import { cleanOrderName } from '@/src/utils/cloneOrders'

/**
 * Stable ÷N ownership for orders that are not yet in careOrderAssignments.
 * Avoids Firestore writes on list — same pool order as round-robin (Shubham → Kawalnain).
 */
function virtualOwnerEmail(orderId: string): string {
  const pool = CARE_EXECUTIVE_EMAILS
  if (!pool.length) return ''
  const id = String(orderId || '')
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return pool[hash % pool.length]
}

function loadOpenUpsellByOrderId(): Map<
  string,
  { id: string; status: string; assignedTo: any }
> {
  const map = new Map<string, { id: string; status: string; assignedTo: any }>()
  const tasks = getCachedCareTasks() || []

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
 * Fast delivered-orders queue for Care.
 * Uses in-memory Firestore/orders snapshot — no per-order Firestore assigns on GET.
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
    const assigneeFilter = resolveCareTaskAssigneeFilter(
      session,
      searchParams.get('assignee'),
    )

    const {
      applyCareTagsToOrders,
      ensureCareTagsHydrated,
    } = require('@/src/services/careOrderTagStore') as {
      applyCareTagsToOrders: (list: any[]) => any[]
      ensureCareTagsHydrated: () => Promise<void>
    }
    const {
      applyCareAssignmentsToOrders,
      hydrateCareAssignmentsFromLocalSources,
      ensureCareAssignmentsHydrated,
    } = require('@/src/services/careAssignmentStore') as {
      applyCareAssignmentsToOrders: (list: any[]) => any[]
      hydrateCareAssignmentsFromLocalSources: () => void
      ensureCareAssignmentsHydrated: () => Promise<void>
    }

    // Instant: disk + in-memory only. Refresh Firestore assignments in background.
    hydrateCareAssignmentsFromLocalSources()
    void ensureCareAssignmentsHydrated()
    void ensureCareTagsHydrated()

    const listFilters = {
      deliveryStatus: 'delivered' as const,
      search,
      datePreset: '30days' as const,
    }

    // Single in-memory pass over Firestore orders snapshot (warm from disk)
    const full = await OrderRepository.getOrderStatusPaginated(1, 5000, listFilters)

    const upsellByOrder = loadOpenUpsellByOrderId()
    let decorated = applyCareAssignmentsToOrders(applyCareTagsToOrders(full.orders || []))

    // Resolve owner without Firestore: stored assignment → else stable virtual split
    decorated = decorated.map((o: any) => {
      const orderId = String(o.id || '')
      const email =
        normalizeCareExecutiveEmail(o.care_executive?.email) ||
        virtualOwnerEmail(orderId)
      if (o.care_executive?.email) return o
      const name = email.split('@')[0] || 'Executive'
      return {
        ...o,
        care_executive: {
          orderId,
          orderName: o.name || null,
          email,
          name,
          label: name,
          virtual: true,
        },
      }
    })

    if (assigneeFilter) {
      decorated = decorated.filter(
        (o: any) =>
          normalizeCareExecutiveEmail(o.care_executive?.email) === assigneeFilter,
      )
    }

    const deliveredTotal = decorated.length
    let openUpsellCount = 0
    for (const o of decorated) {
      if (upsellByOrder.has(String(o.id || ''))) openUpsellCount++
    }
    const needsUpsellCount = Math.max(0, deliveredTotal - openUpsellCount)

    const totalPages = Math.max(1, Math.ceil(deliveredTotal / pageSize) || 1)
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    const pageOrders = decorated.slice(start, start + pageSize)

    const orders = pageOrders.map((o: any) => {
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

    return NextResponse.json({
      orders,
      pagination: {
        page: safePage,
        pageSize,
        total: deliveredTotal,
        totalPages,
      },
      summary: {
        delivered: deliveredTotal,
        openUpsell: openUpsellCount,
        needsUpsell: needsUpsellCount,
        assignee: assigneeFilter || null,
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
