import { NextRequest } from 'next/server'
import { decryptSession, type SessionData } from '@/src/services/auth'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'

export function getSessionFromRequest(req: NextRequest): SessionData | null {
  const cookie = req.cookies.get('fiberise_session')?.value
  if (!cookie) return null
  return decryptSession(cookie)
}

export function requireSession(req: NextRequest): SessionData {
  const session = getSessionFromRequest(req)
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
