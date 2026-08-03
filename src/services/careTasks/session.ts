import { NextRequest } from 'next/server'
import { getAuthFromRequest, type AuthUser } from '@/src/services/auth'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'

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
