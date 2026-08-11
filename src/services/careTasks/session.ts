import { NextRequest } from 'next/server'
import { getAuthFromRequest, type AuthUser } from '@/src/services/auth'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'
import { normalizeCareExecutiveEmail } from '@/src/services/careTasks/executiveConfig'

/** @deprecated use AuthUser */
export type SessionData = AuthUser

/**
 * Care-task APIs: trust the access JWT (email/role) without an extra Firestore user lookup.
 * Full requireAuth is used on login/me; list/summary need to stay fast.
 */
export async function getSessionFromRequest(
  req: NextRequest,
): Promise<AuthUser | null> {
  return getAuthFromRequest(req)
}

export async function requireSession(req: NextRequest): Promise<AuthUser> {
  const session = await getSessionFromRequest(req)
  if (!session?.email) {
    const err = new Error('Unauthorized') as Error & { status: number }
    err.status = 401
    throw err
  }
  return session
}

export function canViewAllCareTasks(role?: string | null): boolean {
  return isAdminRole(role)
}

export function canAccessCareTasksApi(role?: string | null): boolean {
  return isAdminRole(role) || isCareExecutiveRole(role) || role === 'employee'
}

/** Admins may optionally narrow by ?assignee=; care executives always see only their own queue. */
export function resolveCareTaskAssigneeFilter(
  session: { email: string; role?: string | null },
  assigneeParam?: string | null,
): string | undefined {
  const email = normalizeCareExecutiveEmail(session.email)
  if (isCareExecutiveRole(session.role)) return email || undefined
  if (canViewAllCareTasks(session.role) && assigneeParam) {
    return normalizeCareExecutiveEmail(assigneeParam) || undefined
  }
  return undefined
}

export function assertCanAccessCareTask(
  session: { email: string; role?: string | null },
  task: { assignedTo?: { email?: string | null } | null },
): void {
  if (canViewAllCareTasks(session.role)) return
  if (!isCareExecutiveRole(session.role)) {
    const err = new Error('Forbidden') as Error & { status: number }
    err.status = 403
    throw err
  }
  const mine = normalizeCareExecutiveEmail(session.email)
  const assigned = normalizeCareExecutiveEmail(task.assignedTo?.email)
  if (!mine || assigned !== mine) {
    const err = new Error('Forbidden') as Error & { status: number }
    err.status = 403
    throw err
  }
}
