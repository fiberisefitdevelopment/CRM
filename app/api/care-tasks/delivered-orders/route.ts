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
  deliveryDate,
} from '@/src/services/careTasks/generator'
import {
  CARE_EXECUTIVE_EMAILS,
  normalizeCareExecutiveEmail,
} from '@/src/services/careTasks/executiveConfig'
import { isUpsellCareTask } from '@/src/services/careTasks/types'
import { cleanOrderName } from '@/src/utils/cloneOrders'
import { parseFlexibleDate } from '@/src/utils/orderTimeline'
import { isCodOrder } from '@/src/utils/orderPayment'

type UpsellFilter = 'all' | 'needs' | 'open'
type PaymentFilter = 'all' | 'cod' | 'prepaid'
type DatePreset = '7days' | '30days' | '90days' | 'all'
type SortKey =
  | 'delivered_desc'
  | 'delivered_asc'
  | 'ordered_desc'
  | 'ordered_asc'
  | 'total_desc'
  | 'total_asc'
  | 'name_asc'

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
    if (!isUpsellCareTask(t) || !isOpenCareTaskStatus(t.status)) continue
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

function resolveDeliveredAtIso(o: any): string | null {
  const raw =
    o.shiprocket_meta?.delivered_date ||
    o.shiprocket_meta?.delivery_date ||
    o.fulfillments?.[0]?.delivery_date ||
    null
  if (raw) {
    const parsed = parseFlexibleDate(String(raw))
    if (parsed) return parsed.toISOString()
  }
  try {
    const hasDeliveredHint = Boolean(
      o.shiprocket_meta?.delivered_date ||
        o.shiprocket_meta?.delivery_date ||
        o.fulfillments?.[0]?.delivery_date,
    )
    return hasDeliveredHint ? deliveryDate(o).toISOString() : null
  } catch {
    return null
  }
}

function ts(value?: string | null): number {
  if (!value) return 0
  const d = parseFlexibleDate(value) || new Date(value)
  const n = d.getTime()
  return Number.isFinite(n) ? n : 0
}

function sortOrders(list: any[], sort: SortKey): any[] {
  const next = [...list]
  next.sort((a, b) => {
    switch (sort) {
      case 'delivered_asc':
        return ts(a.delivered_at) - ts(b.delivered_at)
      case 'delivered_desc':
        return ts(b.delivered_at) - ts(a.delivered_at)
      case 'ordered_asc':
        return ts(a.created_at) - ts(b.created_at)
      case 'ordered_desc':
        return ts(b.created_at) - ts(a.created_at)
      case 'total_asc':
        return Number(a.total_price || 0) - Number(b.total_price || 0)
      case 'total_desc':
        return Number(b.total_price || 0) - Number(a.total_price || 0)
      case 'name_asc':
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      default:
        return ts(b.delivered_at) - ts(a.delivered_at)
    }
  })
  return next
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
    const upsellFilter = (searchParams.get('upsell') || 'all') as UpsellFilter
    const paymentFilter = (searchParams.get('payment') || 'all') as PaymentFilter
    const datePresetRaw = (searchParams.get('datePreset') || '30days') as DatePreset
    const datePreset: DatePreset = ['7days', '30days', '90days', 'all'].includes(datePresetRaw)
      ? datePresetRaw
      : '30days'
    const sortRaw = (searchParams.get('sort') || 'delivered_desc') as SortKey
    const sort: SortKey = [
      'delivered_desc',
      'delivered_asc',
      'ordered_desc',
      'ordered_asc',
      'total_desc',
      'total_asc',
      'name_asc',
    ].includes(sortRaw)
      ? sortRaw
      : 'delivered_desc'

    const assigneeFilter = resolveCareTaskAssigneeFilter(
      session,
      searchParams.get('assignee'),
    )

    const {
      applyCareTagsToOrders,
      hydrateCareTagsFromLocalSources,
      ensureCareTagsHydrated,
    } = require('@/src/services/careOrderTagStore') as {
      applyCareTagsToOrders: (list: any[]) => any[]
      hydrateCareTagsFromLocalSources: () => void
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
    hydrateCareTagsFromLocalSources()
    hydrateCareAssignmentsFromLocalSources()
    void ensureCareAssignmentsHydrated()
    void ensureCareTagsHydrated()

    const listFilters = {
      deliveryStatus: 'delivered' as const,
      search,
      datePreset: datePreset === 'all' ? 'all' : datePreset,
    }

    // Single in-memory pass over Firestore orders snapshot (warm from disk)
    const full = await OrderRepository.getOrderStatusPaginated(1, 0, listFilters)

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

    if (paymentFilter === 'cod') {
      decorated = decorated.filter((o: any) => isCodOrder(o))
    } else if (paymentFilter === 'prepaid') {
      decorated = decorated.filter((o: any) => !isCodOrder(o))
    }

    // Attach delivered_at + open upsell before summary / upsell filter / sort
    let mapped = decorated.map((o: any) => {
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
        delivered_at: resolveDeliveredAtIso(o),
        hasOpenUpsell: Boolean(openUpsell),
        upsellTaskId: openUpsell?.id || makeManualUpsellDedupeKey(orderId),
        upsellStatus: openUpsell?.status || null,
        upsellAssignee: openUpsell?.assignedTo || null,
        cleanName: cleanOrderName(o.name),
      }
    })

    const deliveredTotal = mapped.length
    let openUpsellCount = 0
    for (const o of mapped) {
      if (o.hasOpenUpsell) openUpsellCount++
    }
    const needsUpsellCount = Math.max(0, deliveredTotal - openUpsellCount)

    if (upsellFilter === 'needs') {
      mapped = mapped.filter((o) => !o.hasOpenUpsell)
    } else if (upsellFilter === 'open') {
      mapped = mapped.filter((o) => o.hasOpenUpsell)
    }

    mapped = sortOrders(mapped, sort)

    const filteredTotal = mapped.length
    const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize) || 1)
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    const orders = mapped.slice(start, start + pageSize)

    return NextResponse.json({
      orders,
      pagination: {
        page: safePage,
        pageSize,
        total: filteredTotal,
        totalPages,
      },
      summary: {
        delivered: deliveredTotal,
        openUpsell: openUpsellCount,
        needsUpsell: needsUpsellCount,
        assignee: assigneeFilter || null,
      },
      filters: {
        upsell: upsellFilter,
        payment: paymentFilter,
        datePreset,
        sort,
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
