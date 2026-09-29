/** Agva Health Tech accounts — isolated workspace (no Fiberise CRM data). */
export const AGVA_HEALTH_HOME = '/agva/calls'

const AGVA_HEALTH_EMAIL_SUFFIX = '@agvahealthtech.com'

const AGVA_ALLOWED_PREFIXES = ['/agva', '/api/auth']

export function isAgvaHealthUser(email?: string | null): boolean {
  const normalized = String(email || '')
    .toLowerCase()
    .trim()
  return normalized.endsWith(AGVA_HEALTH_EMAIL_SUFFIX)
}

/** Care executive: Tasks + Delivered Orders + Care-created orders + Order Status. */
export const CARE_EXEC_HOME = '/customer-service/care-tasks'

const CARE_EXEC_ALLOWED_PREFIXES = [
  '/order-status',
  '/customer-service/care-tasks',
  '/customer-service/delivered-orders',
  '/customer-service/created-orders',
  '/customer-service/create-order',
  '/api/order-status',
  '/api/shopify/orders',
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

/**
 * Login/refresh gate for role-restricted clients (e.g. care-executive mobile app).
 * `requiredRole=care_executive` also accepts legacy `support`.
 */
export function roleSatisfiesRequired(
  userRole?: string | null,
  requiredRole?: string | null,
): boolean {
  const required = String(requiredRole || '')
    .toLowerCase()
    .trim()
  if (!required) return true
  const actual = String(userRole || '')
    .toLowerCase()
    .trim()
  if (required === 'care_executive') return isCareExecutiveRole(actual)
  return actual === required
}

export function homePathForRole(role?: string | null): string {
  return isCareExecutiveRole(role) ? CARE_EXEC_HOME : '/orders'
}

export function homePathForUser(
  email?: string | null,
  role?: string | null,
): string {
  if (isAgvaHealthUser(email)) return AGVA_HEALTH_HOME
  return homePathForRole(role)
}

/** Pages / APIs a care executive may open. Everything else is blocked. */
export function isPathAllowedForRole(role: string | undefined | null, pathname: string): boolean {
  if (!isCareExecutiveRole(role)) return true
  // Full order detail in a new tab (not the Orders list)
  if (pathname.startsWith('/orders/') && pathname !== '/orders/') return true
  return CARE_EXEC_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/** Route + API access for the signed-in user (Agva sandbox overrides role defaults). */
export function isPathAllowedForUser(
  email: string | undefined | null,
  role: string | undefined | null,
  pathname: string,
): boolean {
  if (isAgvaHealthUser(email)) {
    return AGVA_ALLOWED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  }
  return isPathAllowedForRole(role, pathname)
}

export function isAgvaHealthApiAllowed(pathname: string): boolean {
  if (pathname === '/api/auth/me') return true
  if (pathname.startsWith('/api/auth/login')) return true
  if (pathname.startsWith('/api/auth/logout')) return true
  if (pathname.startsWith('/api/auth/refresh')) return true
  if (pathname === '/api/agva' || pathname.startsWith('/api/agva/')) return true
  return false
}
