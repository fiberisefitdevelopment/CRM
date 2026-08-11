import type { AuthUser } from '@/src/services/auth'

const GENERIC_ACTOR_NAMES = new Set([
  'customer care executive',
  'executive',
  'care',
  'support',
])

/** Display label for the logged-in care user (e.g. executive1 → executive 1). */
export function careActorLabel(session: Pick<AuthUser, 'name' | 'email'>): string {
  const name = session.name?.trim()
  if (name && !GENERIC_ACTOR_NAMES.has(name.toLowerCase())) return name
  const local = (session.email.split('@')[0] || 'care').replace(/[_.-]+/g, ' ')
  return local.replace(/([a-zA-Z])(\d)/g, '$1 $2').trim()
}

export function isCareConfirmedOutcome(outcome: string): boolean {
  const o = outcome.toLowerCase().trim()
  return o.includes('cod confirmed') || /^confirmed by /.test(o)
}

export function isCareCancelledOutcome(outcome: string): boolean {
  const o = outcome.toLowerCase().trim()
  return o.includes('cancel requested') && o.includes('customer care')
    || /^cancel requested by /.test(o)
}
