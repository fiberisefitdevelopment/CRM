export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createShopifyOrderFromCare } from '@/src/services/shopifyCareOrders'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'
import { OrderRepository } from '@/src/repositories/orderRepository'

/** Create a Shopify order (via draft → complete) for care executives. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const payment = body.payment === 'paid' ? 'paid' : 'cod'
    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : []
    const shipping = body.shipping || {}

    const result = await createShopifyOrderFromCare({
      email: body.email || null,
      phone: String(body.phone || shipping.phone || ''),
      note: body.note || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      payment,
      shipping: {
        firstName: String(shipping.firstName || ''),
        lastName: String(shipping.lastName || ''),
        phone: String(shipping.phone || body.phone || ''),
        address1: String(shipping.address1 || ''),
        address2: String(shipping.address2 || ''),
        city: String(shipping.city || ''),
        province: String(shipping.province || shipping.state || ''),
        zip: String(shipping.zip || shipping.pincode || ''),
        country: String(shipping.country || 'India'),
      },
      billing: body.billing || null,
      lineItems: lineItems.map((li: any) => ({
        variantId: li.variantId ? Number(li.variantId) : null,
        title: li.title || undefined,
        quantity: Number(li.quantity || 1),
        price: li.price != null ? String(li.price) : undefined,
      })),
      createdByEmail: session.email,
    })

    if (result.order?.id) {
      try {
        OrderRepository.addOrderToCache({
          ...result.order,
          source: 'shopify',
        })
      } catch {
        // cache warm is best-effort
      }
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      orderName: result.orderName,
      draftId: result.draftId,
      payment: result.payment,
      invoiceUrl: result.invoiceUrl,
      createdBy: {
        email: session.email,
        name: session.name || session.email?.split('@')[0] || 'Care agent',
      },
      order: result.order
        ? {
            id: result.order.id,
            name: result.order.name,
            total_price: result.order.total_price,
            financial_status: result.order.financial_status,
            created_at: result.order.created_at,
          }
        : null,
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to create Shopify order' },
      { status },
    )
  }
}
