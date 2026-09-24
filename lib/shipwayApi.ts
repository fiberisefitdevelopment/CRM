import { apiFetch } from '@/lib/auth'

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return data as T
}

export interface ShipwayCourierOption {
  id: string
  carrier_id: number
  name: string
  rate: number | null
  delivery_charge?: number
  cod_charge?: number
  rto_charge?: number
  etd?: string
  rateLabel?: string
  zone?: string | number
}

export async function fetchShipwayCourierOptions(orderId: number | string) {
  const res = await apiFetch(`/api/shipway/courier-options?orderId=${encodeURIComponent(String(orderId))}`)
  return parseJson<{
    ok: boolean
    couriers: ShipwayCourierOption[]
    orderId: number
    orderName: string
    paymentType: string
  }>(res)
}

export async function shipOrderViaShipway(orderId: number | string, carrierId?: string | number) {
  const res = await apiFetch('/api/shipway/ship-confirmed-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      carrierId,
    }),
  })
  return parseJson<{
    ok: boolean
    provider: 'shipway'
    orderName: string
    channelOrderId: string
    carrierId?: string | number
    courier?: string
    awb?: string
    shippingUrl?: string
    order?: any
    message?: string
    warning?: string
  }>(res)
}

export async function fetchShipwayTracking(awb: string) {
  const res = await apiFetch(`/api/shipway/track?awb=${encodeURIComponent(awb)}`)
  return parseJson<any>(res)
}

export async function createShipwayManifest(orderIds: (string | number)[]) {
  const res = await apiFetch('/api/shipway/manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderIds }),
  })
  return parseJson<any>(res)
}
