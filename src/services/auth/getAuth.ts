import type { NextRequest } from 'next/server'
import { verifyAccessToken } from './tokens'
import type { AuthUser } from './types'

/** Extract Bearer token from Authorization header. */
export function getBearerToken(req: NextRequest | Request): string | null {
  const header =
    req.headers.get('authorization') || req.headers.get('Authorization') || ''
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null
}

/**
 * Resolve the authenticated user from `Authorization: Bearer <jwt>` only.
 * Does not load Firestore — use requireAuth for active-user checks.
 */
export async function getAuthFromRequest(
  req: NextRequest | Request,
): Promise<AuthUser | null> {
  const bearer = getBearerToken(req)
  if (!bearer) return null
  return verifyAccessToken(bearer)
}
