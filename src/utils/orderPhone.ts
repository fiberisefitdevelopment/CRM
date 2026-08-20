/** Treat Shiprocket masked placeholders as empty. */
export function isMaskedPhone(phone?: string | null): boolean {
  if (phone == null) return true
  const s = String(phone).trim()
  if (!s) return true
  if (s === 'xxxxxxxxxx') return true
  if (/^x{6,}$/i.test(s.replace(/[\s+\-()]/g, ''))) return true
  return false
}

export function pickFirstRealPhone(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    if (!isMaskedPhone(c)) return String(c).trim()
  }
  return ''
}

export function resolveOrderPhone(
  order: any,
  related?: {
    live?: any
    parent?: any
    clones?: any[]
  },
): string {
  const pool = [
    order?.customer?.phone,
    order?.shipping_address?.phone,
    order?.shiprocket_meta?.customer_phone_unmasked,
    order?.shiprocket_meta?.customer_phone,
    related?.live?.customer?.phone,
    related?.live?.shipping_address?.phone,
    related?.live?.shiprocket_meta?.customer_phone_unmasked,
    related?.parent?.customer?.phone,
    related?.parent?.shipping_address?.phone,
    ...(related?.clones || []).flatMap((c) => [
      c?.customer?.phone,
      c?.shipping_address?.phone,
      c?.shiprocket_meta?.customer_phone_unmasked,
    ]),
  ]
  return pickFirstRealPhone(...pool)
}

export function formatOrderPhoneDisplay(
  order: any,
  related?: { live?: any; parent?: any; clones?: any[] },
): string {
  const phone = resolveOrderPhone(order, related)
  return phone || '—'
}
