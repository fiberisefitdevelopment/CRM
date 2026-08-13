/** Care executive: Tasks + Delivered Orders. */
export const CARE_EXEC_HOME = '/customer-service/care-tasks'

const CARE_EXEC_ALLOWED_PREFIXES = [
  '/customer-service/care-tasks',
  '/customer-service/delivered-orders',
  '/api/care-tasks',
  '/api/customer-service',
  '/api/auth',
]

/** @deprecated use isCareExecutiveRole — kept for older sessions until re-login */
export function isSupportRole(role?: string | null): boolean {
  return role === 'support' || role === 'care_executive'
}

export function isCareExecutiveRole(role?: string | null): boolean {
  return role === 'care_executive' || role === 'support'
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin'
}

export function homePathForRole(role?: string | null): string {
  return isCareExecutiveRole(role) ? CARE_EXEC_HOME : '/orders'
}

/** Pages / APIs a care executive may open. Everything else is blocked. */
export function isPathAllowedForRole(role: string | undefined | null, pathname: string): boolean {
  if (!isCareExecutiveRole(role)) return true
  return CARE_EXEC_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
