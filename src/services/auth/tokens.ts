import { SignJWT, jwtVerify } from 'jose'
import type { AuthUser } from './types'

function getSecretKey(): Uint8Array {
  const secret =
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    'fiberise-dashboard-default-super-secret-key-32-chars'
  return new TextEncoder().encode(secret)
}

/** Sign an access JWT (HS256). */
export async function signAccessToken(user: AuthUser): Promise<string> {
  const expiresAt = Number(user.expiresAt) || Date.now() + 24 * 60 * 60 * 1000
  const ttlSec = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))

  return new SignJWT({
    email: user.email,
    role: user.role,
    sessionId: user.sessionId,
    expiresAt,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.email)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(getSecretKey())
}

/** Verify access JWT; returns null if invalid or expired. */
export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  if (!token || typeof token !== 'string') return null
  // Legacy AES cookie format — reject
  if (token.includes(':') && !token.startsWith('eyJ')) return null

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256'],
    })

    const email = String(payload.email || payload.sub || '')
      .toLowerCase()
      .trim()
    const role = String(payload.role || '')
    if (!email || !role) return null

    const expiresAt =
      typeof payload.expiresAt === 'number'
        ? payload.expiresAt
        : typeof payload.exp === 'number'
          ? payload.exp * 1000
          : 0

    if (!expiresAt || Date.now() > expiresAt) return null

    return {
      email,
      role,
      sessionId: payload.sessionId ? String(payload.sessionId) : undefined,
      expiresAt,
    }
  } catch {
    return null
  }
}

/** Sync-looking wrappers — most route code is async-friendly via getAuthFromRequest. */
export async function encryptSession(data: AuthUser): Promise<string> {
  return signAccessToken(data)
}

export async function decryptSession(token: string): Promise<AuthUser | null> {
  return verifyAccessToken(token)
}
