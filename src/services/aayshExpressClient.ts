let cachedToken: string | null = null
let cachedTokenExpiresAt: number | null = null

function getAayshConfig() {
  return {
    email: process.env.AAYSH_EXPRESS_EMAIL,
    password: process.env.AAYSH_EXPRESS_PASSWORD,
    baseUrl:
      process.env.AAYSH_EXPRESS_BASE_URL?.replace(/\/$/, '') || 'https://aaysh.onrender.com',
  }
}

export interface AayshOrderItem {
  name: string
  sku: string
  units: number
  selling_price: number
  discount?: number
  tax?: number
  hsn?: string | number
}

export interface AayshCreateOrderPayload {
  order_id: string
  order_date?: string
  pickup_location: string
  consignor_name?: string
  billing_customer_name?: string
  billing_last_name?: string
  billing_address?: string
  billing_address_2?: string
  billing_city?: string
  billing_state?: string
  billing_pincode?: string | number
  billing_country?: string
  billing_email?: string
  billing_phone?: string | number
  payment_method?: string
  comment?: string
  order_items: AayshOrderItem[]
  sub_total?: number
  shipping_charges?: number
  giftwrap_charges?: number
  transaction_charges?: number
  total_discount?: number
  weight?: number
  length?: number
  breadth?: number
  height?: number
}

export interface AayshListParams {
  page?: number | string
  per_page?: number | string
  sort?: 'ASC' | 'DESC'
  sort_by?: 'createdAt' | 'orderDate' | 'pickupDate' | 'invoiceValue'
  search?: string
  status?: string
  payment_method?: string
  pickup_location?: string
  courier_name?: string
  from?: string
  to?: string
}

export interface AayshAssignAwbPayload {
  serviceType: 'surface' | 'air' | 'prime' | string
  shipments: string[]
  pickupDate: string
  pickupTime: string
  pickupLocation: string
  notes?: string
}

export interface AayshReschedulePickupPayload {
  shipmentId: string
  pickupDate: string
  pickupTime: string
  pickupLocation: string
  notes?: string
}

export type AayshPdfType = 'labels' | 'manifests' | 'invoices'

function buildQuery(params?: Record<string, string | number | undefined>): string {
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

async function getAuthToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedTokenExpiresAt && now < cachedTokenExpiresAt) {
    return cachedToken
  }

  const { email, password, baseUrl } = getAayshConfig()
  if (!email || !password) {
    throw new Error('Aaysh Express credentials are not configured in environment variables.')
  }

  const res = await fetch(`${baseUrl}/api/user/external/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Aaysh Express auth failed: ${res.status} ${res.statusText} ${text}`)
  }

  const data = (await res.json()) as {
    token?: string
    accessToken?: string
    access_token?: string
    expires_in?: number
  }

  const token = data.token || data.accessToken || data.access_token
  if (!token) throw new Error('Aaysh Express auth response did not contain a token.')

  cachedToken = token
  const ttlMs = data.expires_in ? data.expires_in * 1000 : 23 * 60 * 60 * 1000
  cachedTokenExpiresAt = now + ttlMs
  return cachedToken
}

async function parseResponse(res: Response): Promise<any> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Aaysh Express request failed: ${res.status} ${res.statusText} ${text}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  if (contentType.includes('application/pdf') || contentType.includes('octet-stream')) {
    return res.arrayBuffer()
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function aayshRequest(
  method: string,
  path: string,
  options?: { body?: unknown; formData?: FormData },
): Promise<any> {
  const token = await getAuthToken()
  const { baseUrl } = getAayshConfig()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  const init: RequestInit = {
    method,
    headers,
    cache: 'no-store',
  }

  if (options?.formData) {
    init.body = options.formData
  } else if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  const res = await fetch(`${baseUrl}${path}`, init)
  return parseResponse(res)
}

export async function aayshLogout() {
  cachedToken = null
  cachedTokenExpiresAt = null
  return aayshRequest('POST', '/api/user/external/logout')
}

export async function createAayshOrder(payload: AayshCreateOrderPayload) {
  return aayshRequest('POST', '/api/external/orders/create-order', { body: payload })
}

export async function updateAayshPickupLocation(body: {
  order_id: string[]
  pickup_location: string
}) {
  return aayshRequest('PATCH', '/api/external/orders/update-pickup-location', { body })
}

export async function updateAayshDeliveryLocation(body: Record<string, unknown>) {
  return aayshRequest('POST', '/api/external/orders/update-delivery-location', { body })
}

export async function updateAayshOrder(body: Record<string, unknown>) {
  return aayshRequest('POST', '/api/external/orders/update-order', { body })
}

export async function cancelAayshOrders(orderIds: string[]) {
  return aayshRequest('POST', '/api/external/orders/cancel-order', {
    body: { order_id: orderIds },
  })
}

export async function bulkUploadAayshOrders(file: Blob, filename: string) {
  const formData = new FormData()
  formData.append('file', file, filename)
  return aayshRequest('POST', '/api/external/upload', { formData })
}

export async function listAayshOrders(params?: AayshListParams) {
  return aayshRequest('GET', `/api/external/orders${buildQuery(params as Record<string, string | number>)}`)
}

export async function getAayshOrder(orderId: string) {
  return aayshRequest('GET', `/api/external/orders/${encodeURIComponent(orderId)}`)
}

export async function assignAayshAwb(payload: AayshAssignAwbPayload) {
  return aayshRequest('POST', '/api/external/shipping/assign-awb', { body: payload })
}

export async function listAayshCouriers() {
  return aayshRequest('GET', '/api/external/courier/courierList')
}

export async function listAayshPickups() {
  return aayshRequest('GET', '/api/user/pickups')
}

export async function rescheduleAayshPickup(payload: AayshReschedulePickupPayload) {
  return aayshRequest('PUT', '/api/external/user/pickups/reschedule', { body: payload })
}

export async function cancelAayshPickup(shipmentId: string) {
  return aayshRequest('PUT', '/api/external/user/pickups/cancel', {
    body: { shipmentId },
  })
}

export async function listAayshShipments(params?: AayshListParams) {
  return aayshRequest('GET', `/api/external/shipments${buildQuery(params as Record<string, string | number>)}`)
}

export async function getAayshShipment(shipmentId: string) {
  return aayshRequest('GET', `/api/external/shipments/${encodeURIComponent(shipmentId)}`)
}

export async function cancelAayshShipments(awbs: string[]) {
  return aayshRequest('POST', '/api/external/shipments/cancel', { body: { awbs } })
}

export async function generateAayshPdf(type: AayshPdfType, shipmentIds: string[]) {
  return aayshRequest('POST', `/api/external/pdf/${type}`, {
    body: { shipmentIds },
  })
}

export async function trackAayshByAwb(awb: string) {
  return aayshRequest('GET', `/api/track/awb/${encodeURIComponent(awb)}`)
}

export async function trackAayshByShipment(shipmentId: string) {
  return aayshRequest('GET', `/api/track/shipment/${encodeURIComponent(shipmentId)}`)
}

export async function trackAayshByOrder(orderId: string) {
  return aayshRequest('GET', `/api/track/order/${encodeURIComponent(orderId)}`)
}

export async function trackAayshMultipleAwbs(awbs: string[]) {
  return aayshRequest('POST', '/api/track/multiple', { body: { awbs } })
}
