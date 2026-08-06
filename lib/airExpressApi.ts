import { apiFetch } from '@/lib/auth'
import type {
  AayshAssignAwbPayload,
  AayshCreateOrderPayload,
  AayshListParams,
  AayshPdfType,
  AayshReschedulePickupPayload,
} from '@/src/services/aayshExpressClient'

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return data as T
}

function toQuery(params?: AayshListParams): string {
  if (!params) return ''
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      qs.set(key, String(value))
    }
  })
  const str = qs.toString()
  return str ? `?${str}` : ''
}

export function extractList<T>(data: unknown, keys: string[] = ['data', 'orders', 'shipments', 'pickups', 'results']): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of keys) {
      if (Array.isArray(obj[key])) return obj[key] as T[]
    }
  }
  return []
}

export async function fetchAirExpressOrders(params?: AayshListParams) {
  const res = await apiFetch(`/api/air-express/orders${toQuery(params)}`)
  return parseJson<unknown>(res)
}

export async function fetchAirExpressOrder(orderId: string) {
  const res = await apiFetch(`/api/air-express/orders/${encodeURIComponent(orderId)}`)
  return parseJson<unknown>(res)
}

export async function createAirExpressOrder(payload: AayshCreateOrderPayload) {
  const res = await apiFetch('/api/air-express/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJson<unknown>(res)
}

export async function updateAirExpressPickup(body: { order_id: string[]; pickup_location: string }) {
  const res = await apiFetch('/api/air-express/orders/update-pickup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson<unknown>(res)
}

export async function updateAirExpressDelivery(body: Record<string, unknown>) {
  const res = await apiFetch('/api/air-express/orders/update-delivery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson<unknown>(res)
}

export async function updateAirExpressOrder(body: Record<string, unknown>) {
  const res = await apiFetch('/api/air-express/orders/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson<unknown>(res)
}

export async function cancelAirExpressOrders(orderIds: string[]) {
  const res = await apiFetch('/api/air-express/orders/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderIds }),
  })
  return parseJson<unknown>(res)
}

export async function bulkUploadAirExpressOrders(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiFetch('/api/air-express/orders/bulk-upload', {
    method: 'POST',
    body: formData,
  })
  return parseJson<unknown>(res)
}

export async function fetchAirExpressShipments(params?: AayshListParams) {
  const res = await apiFetch(`/api/air-express/shipments${toQuery(params)}`)
  return parseJson<unknown>(res)
}

export async function fetchAirExpressShipment(shipmentId: string) {
  const res = await apiFetch(`/api/air-express/shipments/${encodeURIComponent(shipmentId)}`)
  return parseJson<unknown>(res)
}

export async function cancelAirExpressShipments(awbs: string[]) {
  const res = await apiFetch('/api/air-express/shipments/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ awbs }),
  })
  return parseJson<unknown>(res)
}

export async function fetchAirExpressCouriers() {
  const res = await apiFetch('/api/air-express/couriers')
  return parseJson<unknown>(res)
}

export async function assignAirExpressAwb(payload: AayshAssignAwbPayload) {
  const res = await apiFetch('/api/air-express/couriers/assign-awb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJson<unknown>(res)
}

export async function fetchAirExpressPickups() {
  const res = await apiFetch('/api/air-express/pickups')
  return parseJson<unknown>(res)
}

export async function rescheduleAirExpressPickup(payload: AayshReschedulePickupPayload) {
  const res = await apiFetch('/api/air-express/pickups/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJson<unknown>(res)
}

export async function cancelAirExpressPickup(shipmentId: string) {
  const res = await apiFetch('/api/air-express/pickups/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipmentId }),
  })
  return parseJson<unknown>(res)
}

export async function downloadAirExpressDocument(type: AayshPdfType, shipmentIds: string[]) {
  const res = await apiFetch(`/api/air-express/documents/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipmentIds }),
  })

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/pdf')) {
    const blob = await res.blob()
    return { blob, url: URL.createObjectURL(blob) }
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Failed to generate ${type}`)
  const pdfUrl =
    data?.url || data?.pdf_url || data?.label_url || data?.data?.url || data?.data
  if (typeof pdfUrl === 'string' && pdfUrl.startsWith('http')) {
    return { url: pdfUrl }
  }
  throw new Error(data?.message || `No PDF URL returned for ${type}`)
}

export async function trackAirExpressByAwb(awb: string) {
  const res = await apiFetch(`/api/air-express/track/awb/${encodeURIComponent(awb)}`)
  return parseJson<unknown>(res)
}

export async function trackAirExpressByShipment(shipmentId: string) {
  const res = await apiFetch(`/api/air-express/track/shipment/${encodeURIComponent(shipmentId)}`)
  return parseJson<unknown>(res)
}

export async function trackAirExpressByOrder(orderId: string) {
  const res = await apiFetch(`/api/air-express/track/order/${encodeURIComponent(orderId)}`)
  return parseJson<unknown>(res)
}

export async function trackAirExpressMultiple(awbs: string[]) {
  const res = await apiFetch('/api/air-express/track/multiple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ awbs }),
  })
  return parseJson<unknown>(res)
}
