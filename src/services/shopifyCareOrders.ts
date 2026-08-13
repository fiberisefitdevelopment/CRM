/**
 * Shopify Admin helpers for care executives creating orders from the CRM.
 * Uses Draft Orders → complete (COD = payment pending).
 */

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'

export type ShopifyCatalogVariant = {
  id: number
  productId: number
  productTitle: string
  title: string
  sku: string
  price: string
  available: boolean
}

export type CreateShopifyOrderLineItem = {
  variantId?: number | null
  title?: string
  quantity: number
  price?: string
}

export type CreateShopifyOrderAddress = {
  firstName: string
  lastName?: string
  phone: string
  address1: string
  address2?: string
  city: string
  province: string
  zip: string
  country?: string
}

export type CreateShopifyOrderInput = {
  email?: string | null
  phone: string
  note?: string | null
  tags?: string[]
  payment: 'cod' | 'paid'
  shipping: CreateShopifyOrderAddress
  billing?: CreateShopifyOrderAddress | null
  lineItems: CreateShopifyOrderLineItem[]
  createdByEmail?: string | null
}

function assertShopifyConfigured() {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    const err = new Error(
      'Shopify credentials are not configured. Set NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.',
    ) as Error & { status: number }
    err.status = 500
    throw err
  }
}

async function shopifyFetch(path: string, init?: RequestInit) {
  assertShopifyConfigured()
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN!,
      ...(init?.headers || {}),
    },
  })
  const text = await res.text().catch(() => '')
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg =
      json?.errors
        ? typeof json.errors === 'string'
          ? json.errors
          : JSON.stringify(json.errors)
        : text || `Shopify request failed (${res.status})`
    const err = new Error(msg) as Error & { status: number }
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502
    throw err
  }
  return json
}

let productsCache: { at: number; variants: ShopifyCatalogVariant[] } | null = null
const PRODUCTS_TTL_MS = 5 * 60 * 1000

/** Active product variants for the care create-order picker. */
export async function listShopifyCatalogVariants(): Promise<ShopifyCatalogVariant[]> {
  const now = Date.now()
  if (productsCache && now - productsCache.at < PRODUCTS_TTL_MS) {
    return productsCache.variants
  }

  const variants: ShopifyCatalogVariant[] = []
  let pages = 0

  // Prefer GraphQL-free REST pagination via Link header; keep it simple with page loop
  let nextUrl: string | null =
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products.json?limit=50&status=active`

  assertShopifyConfigured()

  while (nextUrl && pages < 10) {
    pages += 1
    const url: string = nextUrl
    const res: Response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN!,
      },
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      const err = new Error(text || `Failed to load products (${res.status})`) as Error & {
        status: number
      }
      err.status = res.status
      throw err
    }
    const json = text ? JSON.parse(text) : { products: [] }
    for (const p of json.products || []) {
      for (const v of p.variants || []) {
        variants.push({
          id: Number(v.id),
          productId: Number(p.id),
          productTitle: String(p.title || ''),
          title: String(v.title || 'Default'),
          sku: String(v.sku || ''),
          price: String(v.price || '0'),
          available: v.inventory_management
            ? Number(v.inventory_quantity || 0) > 0
            : true,
        })
      }
    }

    const linkHeader: string = res.headers.get('link') || res.headers.get('Link') || ''
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    nextUrl = match?.[1] || null
  }

  productsCache = { at: now, variants }
  return variants
}

function normalizePhone(phone: string): string {
  return String(phone || '').replace(/\s+/g, '').trim()
}

function addressPayload(addr: CreateShopifyOrderAddress) {
  return {
    first_name: addr.firstName.trim(),
    last_name: (addr.lastName || '').trim() || undefined,
    phone: normalizePhone(addr.phone),
    address1: addr.address1.trim(),
    address2: (addr.address2 || '').trim() || undefined,
    city: addr.city.trim(),
    province: addr.province.trim(),
    zip: String(addr.zip || '').trim(),
    country: (addr.country || 'India').trim() || 'India',
  }
}

/**
 * Create a live Shopify order via Draft Order → complete.
 * COD → payment_pending: true; prepaid/paid → payment_pending: false.
 */
export async function createShopifyOrderFromCare(input: CreateShopifyOrderInput) {
  if (!input.lineItems?.length) {
    const err = new Error('At least one line item is required') as Error & { status: number }
    err.status = 400
    throw err
  }
  if (!input.shipping?.firstName || !input.shipping?.address1 || !input.shipping?.city) {
    const err = new Error('Shipping name, address, and city are required') as Error & {
      status: number
    }
    err.status = 400
    throw err
  }
  if (!normalizePhone(input.phone || input.shipping.phone)) {
    const err = new Error('Customer phone is required') as Error & { status: number }
    err.status = 400
    throw err
  }

  const tags = new Set<string>([
    'care-created',
    input.payment === 'cod' ? 'cod' : 'prepaid',
    ...(input.tags || []).map((t) => String(t).trim()).filter(Boolean),
  ])
  if (input.createdByEmail) tags.add(`care:${input.createdByEmail}`)

  const line_items = input.lineItems.map((li) => {
    const quantity = Math.max(1, Math.floor(Number(li.quantity) || 1))
    if (li.variantId) {
      return { variant_id: Number(li.variantId), quantity }
    }
    const title = String(li.title || '').trim()
    const price = String(li.price || '').trim()
    if (!title || !price) {
      const err = new Error('Custom items need a title and price') as Error & { status: number }
      err.status = 400
      throw err
    }
    return {
      title,
      price,
      quantity,
      requires_shipping: true,
    }
  })

  const shipping = addressPayload({
    ...input.shipping,
    phone: input.shipping.phone || input.phone,
  })
  const billing = addressPayload(
    input.billing
      ? { ...input.billing, phone: input.billing.phone || input.phone }
      : { ...input.shipping, phone: input.shipping.phone || input.phone },
  )

  const noteParts = [
    input.note?.trim() || '',
    input.createdByEmail ? `Created by care: ${input.createdByEmail}` : '',
  ].filter(Boolean)

  const draftPayload = {
    draft_order: {
      line_items,
      email: input.email?.trim() || undefined,
      phone: normalizePhone(input.phone || input.shipping.phone),
      note: noteParts.join('\n') || undefined,
      tags: [...tags].join(', '),
      shipping_address: shipping,
      billing_address: billing,
      use_customer_default_address: false,
    },
  }

  const created = await shopifyFetch('/draft_orders.json', {
    method: 'POST',
    body: JSON.stringify(draftPayload),
  })
  const draft = created?.draft_order
  if (!draft?.id) {
    const err = new Error('Shopify did not return a draft order') as Error & { status: number }
    err.status = 502
    throw err
  }

  const paymentPending = input.payment === 'cod'
  const completed = await shopifyFetch(
    `/draft_orders/${draft.id}/complete.json?payment_pending=${paymentPending}`,
    { method: 'PUT' },
  )

  const order = completed?.draft_order?.order || completed?.order || null
  const orderId = order?.id || completed?.draft_order?.order_id || null
  const orderName = order?.name || null

  // Fetch full order when complete only returns id
  let fullOrder = order
  if (orderId && !order?.line_items) {
    try {
      const fetched = await shopifyFetch(`/orders/${orderId}.json`)
      fullOrder = fetched?.order || order
    } catch {
      // keep slim order
    }
  }

  return {
    draftId: draft.id,
    draftName: draft.name || null,
    orderId: fullOrder?.id || orderId,
    orderName: fullOrder?.name || orderName,
    order: fullOrder,
    payment: input.payment,
    invoiceUrl: draft.invoice_url || completed?.draft_order?.invoice_url || null,
  }
}
