/**
 * Digits-only phone keys for matching CRM orders ↔ care tasks ↔ Salestrail.
 * Returns last-10 Indian mobile digits when possible, else full digit string.
 */

export function digitsOnly(phone?: string | null): string {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '')
}

/** Canonical match key: last 10 digits for IN mobiles, else all digits. */
export function phoneMatchKey(phone?: string | null): string {
  const d = digitsOnly(phone)
  if (!d) return ''
  if (d.length >= 10) return d.slice(-10)
  return d
}

export function phonesMatch(a?: string | null, b?: string | null): boolean {
  const ka = phoneMatchKey(a)
  const kb = phoneMatchKey(b)
  if (!ka || !kb) return false
  return ka === kb
}
