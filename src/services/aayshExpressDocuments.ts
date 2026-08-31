import { OrderRepository } from '@/src/repositories/orderRepository'
import {
  generateAayshPdf,
  getAayshOrder,
  type AayshPdfType,
} from '@/src/services/aayshExpressClient'
import {
  airExpressOrderId,
  airExpressShipmentId,
} from '@/src/utils/airExpressOrder'

function cleanOrderName(name?: string | null) {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
}

function extractShipmentIdFromAaysh(payload: any): string | null {
  const data = payload?.data || payload
  const id =
    data?.shipment?.shipment_id ||
    data?.shipment?.shipmentId ||
    data?.shipment_id ||
    data?.shipmentId ||
    payload?.shipment_id
  const s = id != null ? String(id).trim() : ''
  return s || null
}

export async function resolveAayshShipmentIds(body: {
  shipmentIds?: unknown
  orderIds?: unknown
}): Promise<string[]> {
  const ids = new Set<string>()
  const rawShipments = Array.isArray(body?.shipmentIds) ? body.shipmentIds : []
  for (const id of rawShipments) {
    const s = String(id ?? '').trim()
    if (s) ids.add(s)
  }

  const rawOrders = Array.isArray(body?.orderIds) ? body.orderIds : []
  for (const orderId of rawOrders) {
    if (orderId == null || String(orderId).trim() === '') continue
    const order = await OrderRepository.getCachedOrderById(orderId)
    if (!order) continue

    const stored = airExpressShipmentId(order)
    if (stored) {
      ids.add(stored)
      continue
    }

    const aeId = airExpressOrderId(order) || cleanOrderName(order.name)
    if (!aeId) continue
    try {
      const existing = await getAayshOrder(aeId)
      const shipmentId = extractShipmentIdFromAaysh(existing)
      if (shipmentId) {
        ids.add(shipmentId)
        try {
          OrderRepository.patchOrderInCache(order.id, { airExpressShipmentId: shipmentId })
        } catch {
          // cache stamp is best-effort
        }
      }
    } catch {
      // skip orders Aaysh does not recognise
    }
  }

  return [...ids]
}

export async function generateAayshPdfFromBody(type: AayshPdfType, body: any) {
  const shipmentIds = await resolveAayshShipmentIds(body || {})
  if (!shipmentIds.length) {
    throw new Error(
      'No Aaysh shipment IDs found. Provide shipmentIds or Air Express order IDs.',
    )
  }
  return generateAayshPdf(type, shipmentIds)
}
