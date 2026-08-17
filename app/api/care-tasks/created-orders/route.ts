export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  canAccessCareTasksApi,
  canViewAllCareTasks,
  requireSession,
} from '@/src/services/careTasks/session'
import {
  careExecutiveDisplayName,
  normalizeCareExecutiveEmail,
} from '@/src/services/careTasks/executiveConfig'
import {
  careCreatedByEmail,
  getShopifyCancelFieldsByIds,
  isCareCreatedShopifyOrder,
  parseShopifyTags,
} from '@/src/services/shopifyCareOrders'
import { isCodOrder } from '@/src/utils/orderPayment'
import { parseFlexibleDate } from '@/src/utils/orderTimeline'

function slimLineItems(order: any) {
  const items = Array.isArray(order.line_items) ? order.line_items : []
  return items.map((li: any) => ({
    title: String(li.title || li.name || 'Item'),
    variantTitle: li.variant_title ? String(li.variant_title) : null,
    quantity: Number(li.quantity || 1),
    price: String(li.price || li.original_price || '0'),
    sku: li.sku ? String(li.sku) : null,
  }))
}

function createdByName(email: string | null): string {
  return careExecutiveDisplayName(email)
}

function isCareOrderCancelled(order: any): boolean {
  const financial = String(order?.financial_status || '').toLowerCase()
  const fulfillment = String(order?.fulfillment_status || '').toLowerCase()
  return (
    Boolean(order?.cancelled_at) ||
    financial === 'voided' ||
    financial === 'cancelled' ||
    fulfillment === 'cancelled' ||
    order?.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20)))
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const mineParam =
      searchParams.get('mine') === '1' || searchParams.get('mine') === 'true'
    const paymentFilter = (searchParams.get('payment') || 'all').toLowerCase()
    const statusFilter = (searchParams.get('status') || 'all').toLowerCase()
    const sessionEmail = normalizeCareExecutiveEmail(session.email)
    const scopedToSelf = !canViewAllCareTasks(session.role) || mineParam

    const all = (await OrderRepository.getCachedOrders()) || []
    const careSource = all.filter(isCareCreatedShopifyOrder)
    const liveCancelled = await getShopifyCancelFieldsByIds(
      careSource
        .filter((o: any) => !isCareOrderCancelled(o))
        .map((o: any) => o.id)
        .slice(0, 100),
    )
    let matched = careSource.map((o: any) => {
      const live = liveCancelled.get(String(o.id))
      if (live?.cancelled_at && !o.cancelled_at) {
        OrderRepository.patchOrderInCache(o.id, {
          cancelled_at: live.cancelled_at,
          cancel_reason: live.cancel_reason,
          financial_status: live.financial_status ?? o.financial_status,
          fulfillment_status: live.fulfillment_status ?? o.fulfillment_status,
        })
      }
      const cancelledAt = live?.cancelled_at || o.cancelled_at || null
      const cancelReason = live?.cancel_reason || o.cancel_reason || null
      const financialStatus = live?.financial_status || o.financial_status || null
      const fulfillmentStatus = live?.fulfillment_status || o.fulfillment_status || null
      const createdBy = careCreatedByEmail(o)
      const ship = o.shipping_address || o.billing_address || {}
      const cust = o.customer || {}
      const tags = parseShopifyTags(o)
      const tagsLower = tags.map((t) => t.toLowerCase())
      const payment =
        tagsLower.includes('cod') || isCodOrder(o) ? 'cod' : 'prepaid'
      const cancelled = isCareOrderCancelled({
        ...o,
        cancelled_at: cancelledAt,
        financial_status: financialStatus,
        fulfillment_status: fulfillmentStatus,
      })
      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        cancelled_at: cancelledAt,
        cancel_reason: cancelReason,
        cancelled,
        total_price: o.total_price,
        currency: o.currency || 'INR',
        financial_status: financialStatus,
        fulfillment_status: fulfillmentStatus,
        payment,
        email: o.email || cust.email || null,
        phone:
          ship.phone ||
          cust.phone ||
          o.phone ||
          o.shiprocket_meta?.customer_phone ||
          null,
        customerName:
          [cust.first_name || ship.first_name, cust.last_name || ship.last_name]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          cust.email ||
          '—',
        address1: ship.address1 || null,
        address2: ship.address2 || null,
        city: ship.city || null,
        province: ship.province || ship.province_code || null,
        zip: ship.zip || null,
        country: ship.country || 'India',
        note: o.note || null,
        tags,
        lineItems: slimLineItems(o),
        createdByEmail: createdBy,
        createdByName: createdByName(createdBy),
      }
    })

    if (scopedToSelf) {
      if (!sessionEmail) {
        matched = []
      } else {
        matched = matched.filter((o) => o.createdByEmail === sessionEmail)
      }
    }

    const summary = {
      total: matched.length,
      mine: sessionEmail
        ? matched.filter((o) => o.createdByEmail === sessionEmail).length
        : 0,
      cod: matched.filter((o) => o.payment === 'cod').length,
      prepaid: matched.filter((o) => o.payment !== 'cod').length,
      active: matched.filter((o) => !o.cancelled).length,
      cancelled: matched.filter((o) => o.cancelled).length,
    }

    if (paymentFilter === 'cod' || paymentFilter === 'prepaid') {
      matched = matched.filter((o) =>
        paymentFilter === 'cod' ? o.payment === 'cod' : o.payment !== 'cod',
      )
    }

    if (statusFilter === 'cancelled') {
      matched = matched.filter((o) => o.cancelled)
    } else if (statusFilter === 'active') {
      matched = matched.filter((o) => !o.cancelled)
    }

    if (search) {
      matched = matched.filter((o) => {
        const hay = [
          o.name,
          o.customerName,
          o.phone,
          o.email,
          o.createdByEmail,
          o.createdByName,
          o.city,
          ...(o.lineItems || []).map((li: any) => li.title),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(search)
      })
    }

    matched.sort((a, b) => {
      const ta = parseFlexibleDate(a.created_at)?.getTime() || new Date(a.created_at || 0).getTime()
      const tb = parseFlexibleDate(b.created_at)?.getTime() || new Date(b.created_at || 0).getTime()
      return (tb || 0) - (ta || 0)
    })

    const total = matched.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    const orders = matched.slice(start, start + pageSize)

    return NextResponse.json({
      orders,
      summary,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to list care-created orders' },
      { status },
    )
  }
}
