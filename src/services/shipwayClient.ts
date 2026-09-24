/**
 * Shipway API client.
 * Documentation: https://apidocs.shipway.com
 */

const DEFAULT_BASE_URL = 'https://app.shipway.com'

export interface ShipwayProduct {
  product: string
  price: string
  product_code: string
  product_quantity: string
  discount?: string
  tax_rate?: string
  tax_title?: string
  hsn_code?: string
}

export interface ShipwayPushOrderPayload {
  order_id: string
  carrier_id?: number | string
  warehouse_id?: string
  return_warehouse_id?: string
  ewaybill?: string
  products: ShipwayProduct[]
  discount?: string
  shipping?: string
  order_total: string
  gift_card_amt?: string
  taxes?: string
  payment_type: 'P' | 'C'
  email?: string
  billing_address: string
  billing_address2?: string
  billing_city: string
  billing_state: string
  billing_country: string
  billing_firstname: string
  billing_lastname?: string
  billing_phone: string
  billing_zipcode: string
  shipping_address: string
  shipping_address2?: string
  shipping_city: string
  shipping_state: string
  shipping_country: string
  shipping_firstname: string
  shipping_lastname?: string
  shipping_phone: string
  shipping_zipcode: string
  order_weight?: number
  box_length?: number
  box_breadth?: number
  box_height?: number
  order_date?: string
}

export interface ShipwayRateCardItem {
  carrier_id: number
  courier_name: string
  delivery_charge: number
  rto_charge: number
  cod_charges?: number
  charged_weight?: number
  zone?: number | string
}

function getCredentials() {
  const email = (process.env.SHIPWAY_EMAIL || '').trim()
  const key = (process.env.SHIPWAY_LICENSE_KEY || '').trim()
  const baseUrl = (process.env.SHIPWAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const warehouseId = (process.env.SHIPWAY_DEFAULT_WAREHOUSE_ID || '104014').trim()
  const pickupPincode = (process.env.SHIPWAY_PICKUP_POSTCODE || '201307').trim()

  return { email, key, baseUrl, warehouseId, pickupPincode }
}

function getAuthHeader(): string {
  const { email, key } = getCredentials()
  if (!email || !key) {
    throw new Error('Shipway is not configured. Set SHIPWAY_EMAIL and SHIPWAY_LICENSE_KEY in .env')
  }
  const token = Buffer.from(`${email}:${key}`).toString('base64')
  return `Basic ${token}`
}

export async function shipwayRequest<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: any
    headers?: Record<string, string>
  } = {},
): Promise<T> {
  const { baseUrl } = getCredentials()
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = `${baseUrl}${path}`

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const errorMsg =
      data?.message || data?.error || `Shipway request failed with status ${res.status}`
    throw new Error(errorMsg)
  }

  return data as T
}

/**
 * Fetch all configured warehouses from Shipway
 */
export async function getShipwayWarehouses() {
  return shipwayRequest('/api/getwarehouses')
}

/**
 * Fetch active carriers configured in Shipway
 */
export async function getShipwayCarriers() {
  return shipwayRequest('/api/getcarrier')
}

/**
 * Check carrier rates for given pincodes and weight
 */
export async function checkShipwayCarrierRates(params: {
  fromPincode?: string
  toPincode: string
  paymentType: 'prepaid' | 'cod'
  weight?: number
}) {
  const { pickupPincode } = getCredentials()
  const fromPincode = (params.fromPincode || pickupPincode).replace(/\D/g, '')
  const toPincode = params.toPincode.replace(/\D/g, '')
  const weight = params.weight ?? 0.45

  const qs = new URLSearchParams({
    fromPincode,
    toPincode,
    paymentType: params.paymentType,
    weight: String(weight),
  })

  return shipwayRequest<{
    success: string
    rate_card?: ShipwayRateCardItem[]
    message?: string
  }>(`/api/getshipwaycarrierrates?${qs.toString()}`)
}

/**
 * Push order with label generation to Shipway
 */
export async function pushShipwayOrder(payload: ShipwayPushOrderPayload) {
  const { warehouseId } = getCredentials()
  const fullPayload = {
    warehouse_id: warehouseId,
    return_warehouse_id: warehouseId,
    discount: '0',
    shipping: '0',
    ...payload,
  }

  return shipwayRequest<{
    success: boolean
    message: string
    awb_response?: {
      success: boolean
      message: string
      AWB: string
      carrier_id: string | number
      shipping_url?: string
    }
  }>('/api/v2orders', {
    method: 'POST',
    body: fullPayload,
  })
}

/**
 * Track shipment by AWB number
 */
export async function getShipwayTracking(awb: string) {
  const cleanAwb = String(awb).trim()
  return shipwayRequest(`/api/tracking?awb_numbers=${encodeURIComponent(cleanAwb)}&tracking_history=1`)
}

/**
 * List orders booked on Shipway (Shopify channel ids in `order_id`, AWB, status).
 * @see https://apidocs.shipway.com — GET /api/getorders
 */
export async function listShipwayOrders(page = 1) {
  return shipwayRequest<{
    success: number | boolean
    error?: string
    message: ShipwayListOrder[] | string
  }>(`/api/getorders?page=${encodeURIComponent(String(page))}`)
}

export interface ShipwayListOrder {
  order_id: string
  order_total?: string
  tracking_number?: string
  carrier_title?: string
  carrier_id?: string | number
  name?: string
  shipment_status?: string
  shipment_status_name?: string
  order_date?: string
  invoice_number?: string
  ezyslip_order_id?: string
  payment_method?: string
  s_firstname?: string
  s_lastname?: string
  s_phone?: string
}

/**
 * Create order manifest on Shipway
 */
export async function createShipwayManifest(orderIds: string[]) {
  return shipwayRequest<{
    status: boolean
    message: string
    'manifest ids'?: string
    error_response?: any[]
  }>('/api/Createmanifest/', {
    method: 'POST',
    body: {
      order_ids: orderIds,
    },
  })
}
