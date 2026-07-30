/**
 * Payment helpers — prefer Shiprocket `payment_method` over Shopify `financial_status`.
 * Shopify marks many COD orders as `paid` after cash is collected, which wrongly
 * surfaced as "Prepaid" in the UI.
 */

export type PaymentLike = {
  payment_method?: string | null
  financial_status?: string | null
  fulfillments?: Array<{ tracking_company?: string | null } | null> | null
}

export function isCodOrder(order: PaymentLike): boolean {
  const pm = String(order.payment_method || '').toLowerCase().trim()
  if (pm) {
    if (pm.includes('cod')) return true
    if (pm.includes('prepaid') || pm.includes('pre-paid') || pm === 'online') return false
  }

  // Courier name often encodes payment mode (e.g. "Amazon COD Surface", "Amazon Prepaid Surface")
  const courier = String(order.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  if (courier.includes('cod')) return true
  if (courier.includes('prepaid') || courier.includes('pre-paid')) return false

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
