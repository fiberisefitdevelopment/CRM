import { NextRequest } from 'next/server'
import { requireAuth, type AuthUser } from '@/src/services/auth'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'

/** @deprecated use AuthUser */
export type SessionData = AuthUser

export async function getSessionFromRequest(
  req: NextRequest,
): Promise<AuthUser | null> {
  try {
    return await requireAuth(req)
  } catch {
    return null
  }
}

export async function requireSession(req: NextRequest): Promise<AuthUser> {
  return requireAuth(req)
}

export function canViewAllCareTasks(role?: string | null): boolean {
  return isAdminRole(role)
}

export function canAccessCareTasksApi(role?: string | null): boolean {
  return isAdminRole(role) || isCareExecutiveRole(role) || role === 'employee'
}
