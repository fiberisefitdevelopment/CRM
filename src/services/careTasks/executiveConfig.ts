import type { CareAssignee } from './types'

/** Fixed assignment order: support → Shubham → Kawalnain. */
export const CARE_EXECUTIVE_EMAILS = [
  'support@fiberisefit.com',
  'shubham.kumar@fiberisefit.com',
  'kawalnain.singh@fiberisefit.com',
] as const

export const LEGACY_CARE_EXECUTIVE_EMAILS: Record<string, string> = {
  'executive1@fiberisefit.com': 'shubham.kumar@fiberisefit.com',
  'executive2@fiberisefit.com': 'kawalnain.singh@fiberisefit.com',
}

const DISPLAY_NAMES: Record<string, string> = {
  'support@fiberisefit.com': 'Support',
  'shubham.kumar@fiberisefit.com': 'Shubham',
  'kawalnain.singh@fiberisefit.com': 'Kawalnain',
}

export function normalizeCareExecutiveEmail(email?: string | null): string {
  const normalized = String(email || '').toLowerCase().trim()
  return LEGACY_CARE_EXECUTIVE_EMAILS[normalized] || normalized
}

/** First-name label for badges / tables (Shubham, Kawalnain, Support). */
export function careExecutiveDisplayName(
  email?: string | null,
  name?: string | null,
): string {
  const normalized = normalizeCareExecutiveEmail(email)
  const fixed = DISPLAY_NAMES[normalized]
  if (fixed) return fixed

  const rawName = String(name || '').trim()
  if (
    rawName &&
    !/^executive\s*\d+$/i.test(rawName) &&
    rawName.toLowerCase() !== 'customer care executive'
  ) {
    return rawName.split(/\s+/)[0] || rawName
  }

  const local = normalized.split('@')[0] || 'Executive'
  const first = local.split(/[._-]/)[0] || local
  if (!first) return 'Executive'
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

export function careExecutiveAssignee(
  email: string,
  userId?: string,
  name?: string | null,
): CareAssignee {
  const normalized = normalizeCareExecutiveEmail(email)
  return {
    userId: userId || normalized.split('@')[0],
    email: normalized,
    name: careExecutiveDisplayName(normalized, name),
  }
}

export const FALLBACK_CARE_EXECUTIVES: CareAssignee[] = [
  {
    userId: 'support-fiberisefit',
    email: 'support@fiberisefit.com',
    name: 'Support',
  },
  {
    userId: 'shubham-kumar-fiberisefit',
    email: 'shubham.kumar@fiberisefit.com',
    name: 'Shubham',
  },
  {
    userId: 'kawalnain-singh-fiberisefit',
    email: 'kawalnain.singh@fiberisefit.com',
    name: 'Kawalnain',
  },
]
