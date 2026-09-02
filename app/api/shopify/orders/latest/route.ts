export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { pullLiveShopifyOrdersIntoSnapshot } from '@/src/services/orders/liveOrderSync'

const LATEST_LIMIT = 80

/**
 * Lightweight new-order poll for TopBar + Order Status live feed.
 * Hits Shopify for the newest orders and merges them into the snapshot
 * so the panel does not wait for the 5-minute full sync.
 */
export async function GET() {
  try {
    await pullLiveShopifyOrdersIntoSnapshot(LATEST_LIMIT)
    const all = (await OrderRepository.getCachedOrders()) || []
    const latest = [...all]
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      )
      .slice(0, LATEST_LIMIT)
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        total_price: o.total_price,
        financial_status: o.financial_status,
        payment_method: o.payment_method || null,
        fulfillment_status: o.fulfillment_status || null,
        customer: o.customer
          ? {
              first_name: o.customer.first_name || null,
              last_name: o.customer.last_name || null,
              phone: o.customer.phone || null,
            }
          : null,
        shipping_address: o.shipping_address
          ? {
              first_name: o.shipping_address.first_name || null,
              last_name: o.shipping_address.last_name || null,
              city: o.shipping_address.city || null,
              phone: o.shipping_address.phone || null,
            }
          : null,
        line_items: Array.isArray(o.line_items)
          ? [{ title: o.line_items[0]?.title || null }]
          : [],
      }))

    return NextResponse.json(
      { orders: latest, count: latest.length },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to load latest orders' },
      { status: 500 },
    )
  }
}
