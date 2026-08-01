import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { AuthUser } from './types'
import { ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from './types'

function requireSecret(envName: string, fallbackEnv?: string): Uint8Array {
  const secret =
    process.env[envName] ||
    (fallbackEnv ? process.env[fallbackEnv] : undefined) ||
    (process.env.NODE_ENV !== 'production'
      ? `dev-${envName.toLowerCase()}-fiberise-fallback`
      : undefined)

  if (!secret) {
    throw new Error(`${envName} is required in production`)
  }
  return new TextEncoder().encode(secret)
}

function getAccessSecret(): Uint8Array {
  return requireSecret('JWT_ACCESS_SECRET', 'JWT_SECRET')
}

function getRefreshSecret(): Uint8Array {
  return requireSecret('JWT_REFRESH_SECRET', 'JWT_SECRET')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function signAccessToken(user: AuthUser): Promise<string> {
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_SEC * 1000
  return new SignJWT({
    email: user.email,
    role: user.role,
    name: user.name || '',
    expiresAt,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(getAccessSecret())
}

export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  if (!token || typeof token !== 'string') return null
  if (token.includes(':') && !token.startsWith('eyJ')) return null

  try {
    const { payload } = await jwtVerify(token, getAccessSecret(), {
      algorithms: ['HS256'],
    })

    const id = String(payload.sub || '').trim()
    const email = String(payload.email || '')
      .toLowerCase()
      .trim()
    const role = String(payload.role || '')
    if (!id || !email || !role) return null

    const expiresAt =
      typeof payload.expiresAt === 'number'
        ? payload.expiresAt
        : typeof payload.exp === 'number'
          ? payload.exp * 1000
          : 0

    if (!expiresAt || Date.now() > expiresAt) return null

    return {
      id,
      email,
      name: String(payload.name || email.split('@')[0] || ''),
      role,
      expiresAt,
    }
  } catch {
    return null
  }
}

export async function signRefreshToken(params: {
  userId: string
  email: string
  jti: string
}): Promise<string> {
  return new SignJWT({
    email: params.email,
    typ: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.userId)
    .setJti(params.jti)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SEC}s`)
    .sign(getRefreshSecret())
}

export async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; email: string; jti: string; exp: number } | null> {
  if (!token || typeof token !== 'string') return null
  if (token.includes(':') && !token.startsWith('eyJ')) return null

  try {
    const { payload } = await jwtVerify(token, getRefreshSecret(), {
      algorithms: ['HS256'],
    })

    if (payload.typ !== 'refresh') return null

    const userId = String(payload.sub || '').trim()
    const email = String(payload.email || '')
      .toLowerCase()
      .trim()
    const jti = String(payload.jti || '').trim()
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : 0

    if (!userId || !email || !jti || !exp || Date.now() > exp) return null

    return { userId, email, jti, exp }
  } catch {
    return null
  }
}
