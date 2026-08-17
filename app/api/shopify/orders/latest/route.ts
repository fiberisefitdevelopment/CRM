export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'

const LATEST_LIMIT = 80

/**
 * Lightweight new-order poll for TopBar.
 * Returns recent order ids + notification fields — no tag/assignment decorate.
 */
export async function GET() {
  try {
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
        customer: o.customer
          ? {
              first_name: o.customer.first_name || null,
              last_name: o.customer.last_name || null,
            }
          : null,
        shipping_address: o.shipping_address
          ? { city: o.shipping_address.city || null }
          : null,
        line_items: Array.isArray(o.line_items)
          ? [{ title: o.line_items[0]?.title || null }]
          : [],
      }))

    return NextResponse.json(
      { orders: latest, count: latest.length },
      { status: 200 },
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to load latest orders' },
      { status: 500 },
    )
  }
}
