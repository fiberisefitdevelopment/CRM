import type { AuthUser } from '@/src/services/auth'
import { careExecutiveDisplayName } from '@/src/services/careTasks/executiveConfig'

/** Display label for the logged-in care user (e.g. shubham.kumar → Shubham). */
export function careActorLabel(session: Pick<AuthUser, 'name' | 'email'>): string {
  return careExecutiveDisplayName(session.email, session.name)
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
