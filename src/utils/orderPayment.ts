/**
 * Payment helpers — prefer Shiprocket `payment_method` over Shopify `financial_status`.
 * Shopify marks many COD orders as `paid` after cash is collected, which wrongly
 * surfaced as "Prepaid" in the UI.
 */

export type PaymentLike = {
  payment_method?: string | null
  financial_status?: string | null
  gateway?: string | null
  payment_gateway_names?: string[] | null
  tags?: string | null
  fulfillments?: Array<{ tracking_company?: string | null } | null> | null
}

function looksCod(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('cod') ||
    t.includes('cash on delivery') ||
    t.includes('cash-on-delivery') ||
    t.includes('cash_on_delivery')
  )
}

function looksPrepaid(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('prepaid') ||
    t.includes('pre-paid') ||
    t.includes('pre paid') ||
    t === 'online' ||
    t.includes('razorpay') ||
    t.includes('payu') ||
    t.includes('stripe')
  )
}

export function isCodOrder(order: PaymentLike): boolean {
  const pm = String(order.payment_method || '').toLowerCase().trim()
  if (pm) {
    if (looksCod(pm)) return true
    if (looksPrepaid(pm)) return false
  }

  // Shopify gateway fields (available before Shiprocket enrichment)
  const gateways = [
    String(order.gateway || ''),
    ...(Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names.map(String) : []),
  ]
    .join(' ')
    .toLowerCase()
  if (gateways) {
    if (looksCod(gateways)) return true
    if (looksPrepaid(gateways) && !looksCod(gateways)) return false
  }

  const tags = String(order.tags || '').toLowerCase()
  if (looksCod(tags)) return true

  // Courier name often encodes payment mode (e.g. "Amazon COD Surface")
  const courier = String(order.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  if (looksCod(courier)) return true
  if (looksPrepaid(courier)) return false

  // Fallback when Shiprocket has not enriched the order yet
  const fs = String(order.financial_status || '').toLowerCase()
  return fs !== 'paid'
}

export function getPaymentLabel(order: PaymentLike): 'COD' | 'Prepaid' {
  return isCodOrder(order) ? 'COD' : 'Prepaid'
}

/** Normalize Shiprocket list dates like "31 May 2026, 04:46 PM" → ISO. */
export function parseShiprocketDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toISOString()
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}
