import type { AayshCreateOrderPayload } from '@/src/services/aayshExpressClient'
import { isCodOrder } from '@/src/utils/orderPayment'

function cleanOrderName(name?: string | null): string {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
}

function resolveAddress(order: any) {
  const shipping = order.shipping_address || {}
  const billing = order.billing_address || {}
  const fallback = order.customer?.default_address || {}
  return {
    firstName:
      shipping.first_name ||
      order.customer?.first_name ||
      billing.first_name ||
      fallback.first_name ||
      'Guest',
    lastName:
      shipping.last_name ||
      order.customer?.last_name ||
      billing.last_name ||
      fallback.last_name ||
      '',
    address1: shipping.address1 || billing.address1 || fallback.address1 || 'N/A',
    address2: shipping.address2 || billing.address2 || fallback.address2 || '',
    city: shipping.city || billing.city || fallback.city || 'Mumbai',
    province: shipping.province || billing.province || fallback.province || 'Maharashtra',
    zip: String(shipping.zip || billing.zip || fallback.zip || '400001')
      .replace(/\D/g, '')
      .slice(0, 6) || '400001',
    country: shipping.country || billing.country || fallback.country || 'India',
    phone: String(
      order.customer?.phone || shipping.phone || billing.phone || fallback.phone || '',
    )
      .replace(/[^0-9]/g, '')
      .slice(-10) || '9999999999',
  }
}

/**
 * Build Aaysh create-order payload from a cached CRM order.
 * Sends both Shopify-shaped fields AND legacy snake_case so older Aaysh backends still map address.
 */
export function buildAayshOrderFromShopify(
  order: any,
  pickupLocation?: string,
): AayshCreateOrderPayload & Record<string, unknown> {
  const channelOrderId = cleanOrderName(order.name)
  const addr = resolveAddress(order)
  const payment = isCodOrder(order) ? 'cod' : 'paid'

  const lineItems = (order.line_items || []).map((item: any) => ({
    title: String(item.title || 'Product').trim(),
    sku: String(item.sku || '').trim(),
    quantity: Math.max(1, Number(item.quantity) || 1),
    price: String(item.price ?? '0'),
    discount: Number(item.total_discount || 0),
    tax: 0,
    hsn: '',
  }))

  const fallbackItems =
    lineItems.length > 0
      ? lineItems
      : [
          {
            title: 'Order items',
            sku: '',
            quantity: 1,
            price: String(order.total_price ?? '0'),
            discount: 0,
            tax: 0,
            hsn: '',
          },
        ]

  const pickup =
    pickupLocation ||
    process.env.AAYSH_EXPRESS_PICKUP_LOCATION?.trim() ||
    'Primary'

  return {
    // Shopify schema
    email: order.customer?.email || undefined,
    phone: addr.phone,
    note: `Shipped from CRM Orders · ${order.name || channelOrderId}`,
    tags: ['crm-ship', payment === 'cod' ? 'cod' : 'prepaid'],
    payment,
    shipping: {
      firstName: addr.firstName,
      lastName: addr.lastName,
      phone: addr.phone,
      address1: addr.address1,
      address2: addr.address2,
      city: addr.city,
      province: addr.province,
      zip: addr.zip,
      country: addr.country,
    },
    lineItems: fallbackItems,
    pickup_location: pickup,
    order_id: channelOrderId,
    order_date: (order.created_at || new Date().toISOString()).slice(0, 10),
    weight: 0.45,
    length: 15,
    breadth: 10,
    height: 5,
    shipping_charges: 0,

    // Legacy Aaysh fields (production backends that ignore shipping.*)
    payment_method: payment === 'cod' ? 'COD' : 'Prepaid',
    billing_customer_name: addr.firstName,
    billing_last_name: addr.lastName,
    billing_address: addr.address1,
    billing_address_2: addr.address2,
    billing_city: addr.city,
    billing_state: addr.province,
    billing_pincode: addr.zip,
    billing_country: addr.country,
    billing_email: order.customer?.email || '',
    billing_phone: addr.phone,
    comment: `Shipped from CRM Orders · ${order.name || channelOrderId}`,
    order_items: fallbackItems.map((item: {
      title: string
      sku: string
      quantity: number
      price: string
      discount: number
      tax: number
      hsn: string
    }) => ({
      name: item.title,
      sku: item.sku,
      units: item.quantity,
      selling_price: Number(item.price) || 0,
      discount: item.discount || 0,
      tax: item.tax || 0,
      hsn: item.hsn || '',
    })),
  }
}

export function defaultAayshPickupSchedule() {
  const pickup = new Date()
  pickup.setDate(pickup.getDate() + 1)
  pickup.setHours(0, 0, 0, 0)
  return {
    pickupDate: pickup.toISOString(),
    pickupTime: '11:00 AM',
  }
}
