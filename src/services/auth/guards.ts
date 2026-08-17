import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { getAuthFromRequest } from './getAuth'
import type { AuthUser } from './types'

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

function toAuthUser(
  id: string,
  data: Record<string, unknown>,
  expiresAt?: number,
): AuthUser {
  const email = String(data.email || '')
    .toLowerCase()
    .trim()
  return {
    id,
    email,
    name: String(data.name || email.split('@')[0] || ''),
    role: String(data.role || 'user'),
    expiresAt,
  }
}

const USER_CACHE_TTL_MS = 60_000
const userCache = new Map<string, { at: number; user: AuthUser | null }>()

async function loadActiveUser(userId: string): Promise<AuthUser | null> {
  const hit = userCache.get(userId)
  if (hit && Date.now() - hit.at < USER_CACHE_TTL_MS) return hit.user

  const db = admin.firestore(getFirebaseAdmin())
  const snap = await db.collection('users').doc(userId).get()
  if (!snap.exists) {
    userCache.set(userId, { at: Date.now(), user: null })
    return null
  }
  const data = snap.data() as Record<string, unknown>
  if (data.active === false) {
    userCache.set(userId, { at: Date.now(), user: null })
    return null
  }
  const user = toAuthUser(snap.id, data)
  userCache.set(userId, { at: Date.now(), user })
  return user
}

export async function getCachedActiveUser(userId: string): Promise<AuthUser | null> {
  return loadActiveUser(userId)
}

/**
 * Verify Bearer JWT, load user from Firestore, ensure active.
 * Throws AuthError (401/403) on failure.
 */
export async function requireAuth(req: NextRequest | Request): Promise<AuthUser> {
  const tokenUser = await getAuthFromRequest(req)
  if (!tokenUser?.id) {
    throw new AuthError('Unauthorized', 401)
  }

  const user = await loadActiveUser(tokenUser.id)
  if (!user) {
    throw new AuthError('Unauthorized', 401)
  }

  // Prefer live role from Firestore over stale JWT claim
  return {
    ...user,
    expiresAt: tokenUser.expiresAt,
  }
}

export async function requireRole(
  req: NextRequest | Request,
  ...roles: string[]
): Promise<AuthUser> {
  const user = await requireAuth(req)
  if (!roles.includes(user.role)) {
    throw new AuthError('Forbidden', 403)
  }
  return user
}

export async function optionalAuth(
  req: NextRequest | Request,
): Promise<AuthUser | null> {
  try {
    return await requireAuth(req)
  } catch {
    return null
  }
}

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Auth error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function loadUserByEmail(email: string): Promise<AuthUser | null> {
  const db = admin.firestore(getFirebaseAdmin())
  const query = await db
    .collection('users')
    .where('email', '==', email.toLowerCase().trim())
    .limit(1)
    .get()
  if (query.empty) return null
  const doc = query.docs[0]
  const data = doc.data() as Record<string, unknown>
  if (data.active === false) return null
  return toAuthUser(doc.id, data)
}
