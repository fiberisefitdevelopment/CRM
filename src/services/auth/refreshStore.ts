import crypto from 'crypto'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { hashToken, signAccessToken, signRefreshToken } from './tokens'
import type { AuthUser, DeviceMeta, RefreshTokenRecord, TokenPair } from './types'
import { REFRESH_TOKEN_TTL_SEC } from './types'

const COLLECTION = 'refresh_tokens'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function clientMeta(
  req?: Request,
  device?: DeviceMeta,
): Pick<RefreshTokenRecord, 'deviceId' | 'deviceName' | 'platform' | 'ipAddress' | 'userAgent'> {
  const headers = req?.headers
  const forwarded = headers?.get('x-forwarded-for') || ''
  const ipAddress = forwarded.split(',')[0]?.trim() || headers?.get('x-real-ip') || 'unknown'
  return {
    deviceId: device?.deviceId || crypto.randomUUID(),
    deviceName: device?.deviceName || 'Unknown device',
    platform: device?.platform || 'web',
    ipAddress,
    userAgent: headers?.get('user-agent') || 'unknown',
  }
}

export async function issueTokenPair(
  user: AuthUser,
  opts?: { req?: Request; device?: DeviceMeta },
): Promise<TokenPair & { refreshTokenId: string }> {
  const db = getDb()
  const jti = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + REFRESH_TOKEN_TTL_SEC * 1000
  const meta = clientMeta(opts?.req, opts?.device)

  const refreshToken = await signRefreshToken({
    userId: user.id,
    email: user.email,
    jti,
  })
  const accessToken = await signAccessToken(user)

  const docRef = db.collection(COLLECTION).doc(jti)
  const record: RefreshTokenRecord = {
    id: jti,
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    ...meta,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
    revoked: false,
  }
  await docRef.set(record)

  return {
    accessToken,
    refreshToken,
    expiresIn: 3600,
    refreshTokenId: jti,
  }
}

export async function findValidRefreshRecord(
  refreshToken: string,
): Promise<RefreshTokenRecord | null> {
  const { verifyRefreshToken } = await import('./tokens')
  const claims = await verifyRefreshToken(refreshToken)
  if (!claims) return null

  const db = getDb()
  const snap = await db.collection(COLLECTION).doc(claims.jti).get()
  if (!snap.exists) return null

  const data = snap.data() as RefreshTokenRecord
  if (data.revoked) return null
  if (data.expiresAt <= Date.now()) return null
  if (data.tokenHash !== hashToken(refreshToken)) return null
  if (data.userId !== claims.userId) return null

  return { ...data, id: snap.id }
}

export async function rotateRefreshToken(
  oldRefreshToken: string,
  user: AuthUser,
  opts?: { req?: Request; device?: DeviceMeta; existing?: RefreshTokenRecord | null },
): Promise<TokenPair | null> {
  const existing = opts?.existing ?? (await findValidRefreshRecord(oldRefreshToken))
  if (!existing) return null

  const db = getDb()
  await db.collection(COLLECTION).doc(existing.id).update({
    revoked: true,
    lastUsedAt: Date.now(),
  })

  const pair = await issueTokenPair(user, {
    req: opts?.req,
    device: {
      deviceId: opts?.device?.deviceId || existing.deviceId,
      deviceName: opts?.device?.deviceName || existing.deviceName,
      platform: opts?.device?.platform || existing.platform,
    },
  })

  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<{
  revoked: boolean
  userId?: string
  tokenId?: string
}> {
  const existing = await findValidRefreshRecord(refreshToken)
  if (!existing) {
    // Also try by jti even if already invalid, for idempotent logout
    const { verifyRefreshToken } = await import('./tokens')
    const claims = await verifyRefreshToken(refreshToken)
    if (!claims) return { revoked: false }

    const db = getDb()
    const snap = await db.collection(COLLECTION).doc(claims.jti).get()
    if (!snap.exists) return { revoked: false }
    await snap.ref.update({ revoked: true, lastUsedAt: Date.now() })
    return { revoked: true, userId: claims.userId, tokenId: claims.jti }
  }

  const db = getDb()
  await db.collection(COLLECTION).doc(existing.id).update({
    revoked: true,
    lastUsedAt: Date.now(),
  })
  return { revoked: true, userId: existing.userId, tokenId: existing.id }
}

export async function revokeAllRefreshTokens(userId: string): Promise<number> {
  const db = getDb()
  const snap = await db
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('revoked', '==', false)
    .get()

  if (snap.empty) return 0

  const batch = db.batch()
  const now = Date.now()
  snap.docs.forEach((doc) => {
    batch.update(doc.ref, { revoked: true, lastUsedAt: now })
  })
  await batch.commit()
  return snap.size
}

export async function touchRefreshToken(tokenId: string): Promise<void> {
  const db = getDb()
  await db.collection(COLLECTION).doc(tokenId).update({ lastUsedAt: Date.now() })
}
