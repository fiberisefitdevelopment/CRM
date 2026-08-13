const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external'

let cachedToken: string | null = null
let cachedTokenExpiresAt: number | null = null

async function getAuthToken(): Promise<string> {
  const now = Date.now()

  if (cachedToken && cachedTokenExpiresAt && now < cachedTokenExpiresAt) {
    return cachedToken
  }

  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    throw new Error('Shiprocket credentials are not configured in environment variables.')
  }

  const res = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shiprocket auth failed: ${res.status} ${res.statusText} ${text}`)
  }

  const data = (await res.json()) as { token?: string; expires_in?: number }
  if (!data.token) throw new Error('Shiprocket auth response did not contain a token.')

  cachedToken = data.token
  const ttlMs = data.expires_in ? data.expires_in * 1000 : 9 * 24 * 60 * 60 * 1000
  cachedTokenExpiresAt = now + ttlMs

  return cachedToken
}

async function shiprocketGet(path: string): Promise<any> {
  const token = await getAuthToken()

  const res = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shiprocket GET ${path} failed: ${res.status} ${res.statusText} ${text}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res.arrayBuffer()
}

async function shiprocketPost(path: string, body: any): Promise<any> {
  const token = await getAuthToken()

  const res = await fetch(`${SHIPROCKET_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shiprocket POST ${path} failed: ${res.status} ${res.statusText} ${text}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res.arrayBuffer()
}

export interface ShiprocketAdhocOrderItem {
  name: string
  sku: string
  units: number
  selling_price: number
  discount?: number
  tax?: number
  hsn?: number
}

export interface ShiprocketAdhocOrderPayload {
  order_id: string
  order_date: string
  pickup_location: string
  comment?: string
  billing_customer_name: string
  billing_last_name?: string
  billing_address: string
  billing_address_2?: string
  billing_city: string
  billing_pincode: number
  billing_state: string
  billing_country: string
  billing_email: string
  billing_phone: string | number
  shipping_is_billing: boolean
  order_items: ShiprocketAdhocOrderItem[]
  payment_method: string
  shipping_charges?: number
  giftwrap_charges?: number
  transaction_charges?: number
  total_discount?: number
  sub_total: number
  length: number
  breadth: number
  height: number
  weight: number
}

export async function createShiprocketAdhocOrder(payload: ShiprocketAdhocOrderPayload) {
  return shiprocketPost('/orders/create/adhoc', payload)
}

export async function cancelShiprocketOrder(orderId: number) {
  return shiprocketPost('/orders/cancel', { ids: [orderId] })
}

export async function assignShiprocketAwb(params: {
  shipmentId: number | string
  courierId?: number | string
}): Promise<any> {
  const body: Record<string, unknown> = {
    shipment_id: params.shipmentId,
  }
  if (params.courierId != null && params.courierId !== '') {
    body.courier_id = params.courierId
  }
  return shiprocketPost('/courier/assign/awb', body)
}

export async function scheduleShiprocketPickup(params: {
  shipmentId: number | string
  pickupDate?: string
}): Promise<any> {
  const body: Record<string, unknown> = {
    shipment_id: [params.shipmentId],
  }
  if (params.pickupDate) body.pickup_date = [params.pickupDate]
  return shiprocketPost('/courier/generate/pickup', body)
}

/**
 * Resolve a Shiprocket order by the channel order number
 * (e.g. Shopify order.name "#1021" → strip # → "1021")
 */
export async function findShiprocketOrderByChannelNumber(
  orderName: string,
): Promise<{
  id: number
  shipment_id: number | null
  status?: string | null
  awb?: string | null
  courier?: string | null
  raw?: any
} | null> {
  const clean = orderName.replace(/^#/, '').trim()
  try {
    const data = await shiprocketGet(
      `/orders?channel_order_id=${encodeURIComponent(clean)}`,
    )
    const list: any[] = data?.data ?? data?.orders ?? []
    if (!Array.isArray(list) || list.length === 0) return null
    // Prefer non-cancelled / non-clone-looking rows with the exact channel id
    const exact = list.find(
      (o) =>
        String(o.channel_order_id || '')
          .replace(/^#/, '')
          .trim()
          .toLowerCase() === clean.toLowerCase(),
    )
    const order = exact || list[0]
    const shipment = order.shipments?.[0]
    return {
      id: order.id ?? order.order_id,
      shipment_id: shipment?.id ?? order.shipment_id ?? null,
      status: order.status || shipment?.status || null,
      awb: shipment?.awb || order.awb || null,
      courier: shipment?.courier || order.courier_name || null,
      raw: order,
    }
  } catch {
    return null
  }
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchShiprocketOrderPages(qs: string): Promise<any[]> {
  const path = qs ? `/orders?${qs}&per_page=100&page=1` : `/orders?per_page=100&page=1`
  const data = await shiprocketGet(path)

  // Shiprocket sometimes returns HTTP 200 with an error message and empty data
  if (data?.message && (!data?.data || data.data.length === 0) && !data?.meta?.pagination?.total) {
    console.warn(`⚠️ Shiprocket orders empty for [${qs || 'default'}]: ${data.message}`)
    return []
  }

  let allOrders = data?.data ?? data?.orders ?? []
  if (!Array.isArray(allOrders)) allOrders = []

  const totalPages = data?.meta?.pagination?.total_pages
  if (typeof totalPages === 'number' && totalPages > 1) {
    const batchSize = 5
    for (let start = 2; start <= totalPages; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalPages)
      const pagePromises: Promise<any>[] = []
      for (let p = start; p <= end; p++) {
        const pagePath = qs
          ? `/orders?${qs}&per_page=100&page=${p}`
          : `/orders?per_page=100&page=${p}`
        pagePromises.push(shiprocketGet(pagePath))
      }
      const results = await Promise.all(pagePromises)
      results.forEach((res) => {
        const list = res?.data ?? res?.orders ?? []
        if (Array.isArray(list)) allOrders = allOrders.concat(list)
      })
    }
  }

  return allOrders
}

/**
 * Fetch Shiprocket orders for enrichment.
 *
 * IMPORTANT: Shiprocket's `from`/`to` rejects some wide/old ranges (e.g. lookback
 * into the previous calendar year with YYYY-MM-DD) and returns 0 rows with a parse
 * error — which previously wiped payment/status enrichment. We fetch year-to-date
 * (known-good) and fall back to the default recent list.
 */
export async function getAllShiprocketOrders(): Promise<any[]> {
  try {
    const today = new Date()
    const ytdFrom = `${today.getFullYear()}-01-01`
    const ytdTo = toYmd(today)

    const [ytdOrders, recentOrders] = await Promise.all([
      fetchShiprocketOrderPages(`from=${ytdFrom}&to=${ytdTo}`),
      fetchShiprocketOrderPages(''),
    ])

    // If YTD somehow comes back empty, keep recent list so sync is not blind
    let allOrders = ytdOrders.length > 0 ? ytdOrders.concat(recentOrders) : recentOrders

    // Dedupe by Shiprocket order id
    const seen = new Set<string>()
    const deduped: any[] = []
    for (const o of allOrders) {
      const key = String(o.id ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(o)
    }

    console.log(
      `📦 Shiprocket sync fetched ${deduped.length} orders (YTD ${ytdFrom}→${ytdTo}: ${ytdOrders.length}, recent: ${recentOrders.length})`,
    )
    return deduped
  } catch (error) {
    console.error('Error fetching Shiprocket orders in parallel:', error)
    return []
  }
}

/**
 * Fetch Shiprocket orders in a date window only (incremental / Phase 4).
 * Does not pull full YTD history.
 */
export async function getShiprocketOrdersInDateRange(
  fromYmd: string,
  toYmd: string,
): Promise<any[]> {
  try {
    const orders = await fetchShiprocketOrderPages(`from=${fromYmd}&to=${toYmd}`)
    const seen = new Set<string>()
    const deduped: any[] = []
    for (const o of orders) {
      const key = String(o.id ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(o)
    }
    console.log(
      `📦 Shiprocket incremental fetch ${fromYmd}→${toYmd}: ${deduped.length} orders`,
    )
    return deduped
  } catch (error) {
    console.error('Error fetching Shiprocket orders in date range:', error)
    return []
  }
}

/**
 * Convenience: last N days inclusive through today (YYYY-MM-DD).
 */
export async function getRecentShiprocketOrders(lookbackDays = 14): Promise<any[]> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - Math.max(1, lookbackDays))
  return getShiprocketOrdersInDateRange(toYmd(from), toYmd(today))
}

export async function getShiprocketInvoices(orderIds: number[]) {
  // POST /orders/print/invoice with { ids: [shiprocketOrderId, ...] }
  return shiprocketPost('/orders/print/invoice', { ids: orderIds })
}

export async function getShiprocketManifest(shipmentIds: number[]) {
  // POST /manifests/print with { shipment_id: [...] }
  return shiprocketPost('/manifests/print', { shipment_id: shipmentIds })
}

export async function generateShiprocketLabels(shipmentIds: number[]) {
  // POST /courier/generate/label with { shipment_id: [...] }
  return shiprocketPost('/courier/generate/label', { shipment_id: shipmentIds })
}

export async function getShiprocketTrackingByAwb(awb: string): Promise<any> {
  const clean = String(awb || '').trim()
  if (!clean) throw new Error('AWB is required')
  return shiprocketGet(`/courier/track/awb/${encodeURIComponent(clean)}`)
}
