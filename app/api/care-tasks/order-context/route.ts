export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { OrderRepository } from '@/src/repositories/orderRepository'
import { getShiprocketTrackingByAwb } from '@/src/services/shiprocketClient'
import {
  buildTimeline,
  fulfillmentStageLabel,
  isShiprocketDeliveredStatus,
  normalizeShipmentStatus,
  parseFlexibleDate,
} from '@/src/utils/orderTimeline'
import { cleanOrderName, findCloneTrailIndexed, buildCloneOrderIndex } from '@/src/utils/cloneOrders'
import {
  canAccessCareTasksApi,
  requireSession,
} from '@/src/services/careTasks/session'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'

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
    // Live Shiprocket is opt-in — default is cache-only so expand feels instant
    const live = searchParams.get('live') === '1' || searchParams.get('live') === 'true'

    const all = (await OrderRepository.getCachedOrders()) || []
    const queryName = orderName || orderId
    let order =
      (orderId ? await OrderRepository.getCachedOrderById(orderId) : null) ||
      all.find((o: any) => String(o.id) === String(orderId)) ||
      all.find((o: any) => cleanOrderName(o.name) === cleanOrderName(queryName)) ||
      null

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found in cache. Open Order Status once to refresh, then retry.' },
        { status: 404 },
      )
    }

    const { parent, clones, operational } = findCloneTrailIndexed(
      order,
      buildCloneOrderIndex(all),
    )

    let tracking: any = null
    const awb = operational?.fulfillments?.[0]?.tracking_number
    if (live && awb) {
      try {
        tracking = await getShiprocketTrackingByAwb(String(awb).trim())
      } catch {
        tracking = null
      }
    }

    const trackStatusRaw = String(
      tracking?.tracking_data?.shipment_track?.[0]?.current_status ||
        tracking?.tracking_data?.shipment_status ||
        tracking?.current_status ||
        '',
    ).trim()

    const orderForStatus =
      trackStatusRaw
        ? {
            ...operational,
            shiprocket_meta: {
              ...(operational?.shiprocket_meta || {}),
              status: trackStatusRaw,
            },
          }
        : operational

    const delivered = isShiprocketDeliveredStatus(orderForStatus)
    const status = normalizeShipmentStatus(orderForStatus)
    const timeline = buildTimeline(orderForStatus, tracking)

    const slim = (o: any) => {
      if (!o) return null
      const addr = o.shipping_address || o.billing_address || {}
      const meta = o.shiprocket_meta || {}
      const etd =
        meta.etd_date ||
        meta.etd ||
        meta.estimated_delivery_date ||
        meta.edd ||
        o.fulfillments?.[0]?.estimated_delivery_at ||
        null
      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        status: normalizeShipmentStatus(o),
        statusLabel: fulfillmentStageLabel(normalizeShipmentStatus(o)),
        awb: o.fulfillments?.[0]?.tracking_number || null,
        courier: o.fulfillments?.[0]?.tracking_company || null,
        etd,
        shipmentStatus: o.fulfillments?.[0]?.shipment_status || null,
        state: addr.province || addr.province_code || meta.customer_state || null,
        city: addr.city || meta.customer_city || null,
        pincode: addr.zip || meta.customer_pincode || null,
      }
    }

    const addrSource = operational || order
    const ship = addrSource?.shipping_address || addrSource?.billing_address || {}
    const cust = addrSource?.customer || {}
    const meta = addrSource?.shiprocket_meta || {}
    const firstName =
      String(ship.first_name || cust.first_name || '').trim() ||
      String(cust.name || '').trim().split(/\s+/)[0] ||
      ''
    const lastName =
      String(ship.last_name || cust.last_name || '').trim() ||
      String(cust.name || '')
        .trim()
        .split(/\s+/)
        .slice(1)
        .join(' ') ||
      ''

    const customerPhone = String(
      ship.phone ||
        cust.phone ||
        meta.customer_phone ||
        addrSource?.phone ||
        '',
    ).trim()
    const phoneKey = phoneMatchKey(customerPhone)

    const orderPhoneKey = (o: any): string => {
      const s = o?.shipping_address || o?.billing_address || {}
      const c = o?.customer || {}
      const m = o?.shiprocket_meta || {}
      return phoneMatchKey(
        s.phone || c.phone || m.customer_phone || o?.phone || '',
      )
    }

    const samePhoneOrders = !phoneKey
      ? []
      : all
          .filter((o: any) => orderPhoneKey(o) === phoneKey)
          .map((o: any) => {
            const line = Array.isArray(o.line_items) ? o.line_items[0] : null
            return {
              id: o.id,
              name: o.name,
              created_at: o.created_at || null,
              total_price: String(o.total_price || '0'),
              currency: o.currency || 'INR',
              financial_status: o.financial_status || null,
              fulfillment_status: o.fulfillment_status || null,
              cancelled_at: o.cancelled_at || null,
              statusLabel: fulfillmentStageLabel(normalizeShipmentStatus(o)),
              productTitle: line?.title || line?.name || null,
              isCurrent: String(o.id) === String(order.id),
            }
          })
          .sort((a: any, b: any) => {
            const ta =
              parseFlexibleDate(a.created_at)?.getTime() ||
              new Date(a.created_at || 0).getTime() ||
              0
            const tb =
              parseFlexibleDate(b.created_at)?.getTime() ||
              new Date(b.created_at || 0).getTime() ||
              0
            return ta - tb
          })

    const repeatedCustomer = samePhoneOrders.length > 1

    return NextResponse.json({
      order: slim(order),
      operational: slim(operational),
      parent: slim(parent),
      clones: clones.map(slim),
      delivered,
      status,
      statusLabel: fulfillmentStageLabel(status),
      // Prefer operational (live clone) address / ETD for care agents
      state: slim(operational)?.state || slim(order)?.state || null,
      city: slim(operational)?.city || slim(order)?.city || null,
      pincode: slim(operational)?.pincode || slim(order)?.pincode || null,
      etd: slim(operational)?.etd || slim(order)?.etd || null,
      timeline,
      trackingLoaded: Boolean(tracking),
      customer: {
        firstName,
        lastName,
        email: String(cust.email || addrSource?.email || '').trim() || null,
        phone: customerPhone || null,
        address1: String(ship.address1 || '').trim() || null,
        address2: String(ship.address2 || '').trim() || null,
        city: String(ship.city || meta.customer_city || '').trim() || null,
        province: String(
          ship.province || ship.province_code || meta.customer_state || '',
        ).trim() || null,
        zip: String(ship.zip || meta.customer_pincode || '').trim() || null,
        country: String(ship.country || ship.country_code || 'India').trim() || 'India',
      },
      phoneKey: phoneKey || null,
      repeatedCustomer,
      samePhoneOrders,
      samePhoneOrderCount: samePhoneOrders.length,
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to load order context' },
      { status },
    )
  }
}
