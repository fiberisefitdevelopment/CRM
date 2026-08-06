export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { getShiprocketTrackingByAwb } from '@/src/services/shiprocketClient'
import {
  buildTimeline,
  fulfillmentStageLabel,
  isShiprocketDeliveredStatus,
  normalizeShipmentStatus,
} from '@/src/utils/orderTimeline'
import { cleanOrderName, findCloneTrail } from '@/src/utils/cloneOrders'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'

/**
 * Order snapshot + timeline/clone trail for Care Tasks expand panel.
 * Scoped so care executives do not need full Orders API access.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const orderId = searchParams.get('orderId') || ''
    const orderName = searchParams.get('orderName') || ''

    const all = (await OrderRepository.getCachedOrders()) || []
    let order =
      (orderId ? await OrderRepository.getCachedOrderById(orderId) : null) ||
      all.find((o: any) => String(o.id) === String(orderId)) ||
      all.find((o: any) => cleanOrderName(o.name) === cleanOrderName(orderName)) ||
      null

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found in cache. Open Order Status once to refresh, then retry.' },
        { status: 404 },
      )
    }

    const { parent, clones, operational } = findCloneTrail(order, all)
    const delivered = isShiprocketDeliveredStatus(operational)

    let tracking: any = null
    const awb = operational?.fulfillments?.[0]?.tracking_number
    if (awb && !delivered) {
      try {
        tracking = await getShiprocketTrackingByAwb(String(awb).trim())
      } catch {
        tracking = null
      }
    }

    const timeline = buildTimeline(operational, tracking)
    const status = normalizeShipmentStatus(operational)

    const slim = (o: any) =>
      o
        ? {
            id: o.id,
            name: o.name,
            created_at: o.created_at,
            status: normalizeShipmentStatus(o),
            statusLabel: fulfillmentStageLabel(normalizeShipmentStatus(o)),
            awb: o.fulfillments?.[0]?.tracking_number || null,
            courier: o.fulfillments?.[0]?.tracking_company || null,
            etd: o.shiprocket_meta?.etd_date || null,
            shipmentStatus: o.fulfillments?.[0]?.shipment_status || null,
          }
        : null

    return NextResponse.json({
      order: slim(order),
      operational: slim(operational),
      parent: slim(parent),
      clones: clones.map(slim),
      delivered,
      status,
      statusLabel: fulfillmentStageLabel(status),
      timeline,
      trackingLoaded: Boolean(tracking),
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to load order context' },
      { status },
    )
  }
}
