import type { NextRequest } from 'next/server'
import { AUTH_COOKIE } from './types'
import { verifyAccessToken } from './tokens'
import type { AuthUser } from './types'

/**
 * Resolve the authenticated user from:
 *  1. `Authorization: Bearer <jwt>`
 *  2. HTTP-only cookie `fiberise_session`
 */
export async function getAuthFromRequest(
  req: NextRequest | Request,
): Promise<AuthUser | null> {
  const header =
    req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (bearer) {
    const user = await verifyAccessToken(bearer)
    if (user) return user
  }

  // NextRequest cookies
  if ('cookies' in req && typeof (req as NextRequest).cookies?.get === 'function') {
    const cookie = (req as NextRequest).cookies.get(AUTH_COOKIE)?.value
    if (cookie) return verifyAccessToken(cookie)
  }

  // Fallback: parse Cookie header
  const raw = req.headers.get('cookie') || ''
  const match = raw.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  if (match?.[1]) {
    return verifyAccessToken(decodeURIComponent(match[1]))
  }

  return null
}

export function getBearerToken(req: NextRequest | Request): string | null {
  const header =
    req.headers.get('authorization') || req.headers.get('Authorization') || ''
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null
}
