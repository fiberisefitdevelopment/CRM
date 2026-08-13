export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { createManualUpsellTask } from '@/src/services/careTasks/generator'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'
import { isShiprocketDeliveredStatus } from '@/src/utils/orderTimeline'
import { cleanOrderName } from '@/src/utils/cloneOrders'

/** Create a manual Upsell Call care task for a delivered order. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const orderId = String(body.orderId || body.id || '').trim()
    const orderName = String(body.orderName || '').trim()
    if (!orderId && !orderName) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const all = (await OrderRepository.getCachedOrders()) || []
    let order =
      (orderId ? await OrderRepository.getCachedOrderById(orderId) : null) ||
      all.find((o: any) => String(o.id) === String(orderId)) ||
      all.find((o: any) => cleanOrderName(o.name) === cleanOrderName(orderName)) ||
      null

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found in cache. Refresh Order Status, then retry.' },
        { status: 404 },
      )
    }

    // Prefer live clone for delivery check when present
    const { findCloneTrail } = require('@/src/utils/cloneOrders') as {
      findCloneTrail: (order: any, all: any[]) => { operational: any }
    }
    const { operational } = findCloneTrail(order, all)
    const live = operational || order
    if (!isShiprocketDeliveredStatus(live)) {
      return NextResponse.json({ error: 'Order is not delivered yet' }, { status: 400 })
    }

    const result = await createManualUpsellTask(live)
    return NextResponse.json({
      success: true,
      created: result.created,
      task: result.task,
      existing: result.existing || null,
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to create upsell task' },
      { status },
    )
  }
}
