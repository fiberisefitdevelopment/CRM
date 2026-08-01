export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  /** @deprecated kept for call sites that still pass sessionId into audit logs */
  sessionId?: string
  expiresAt?: number
}

/** @deprecated use AuthUser */
export type SessionData = AuthUser

export const AUTH_HEADER = 'authorization'

export const ACCESS_TOKEN_TTL_SEC = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60 // 30 days

export interface RefreshTokenRecord {
  id: string
  userId: string
  tokenHash: string
  deviceId: string
  deviceName: string
  platform: string
  ipAddress: string
  userAgent: string
  createdAt: number
  lastUsedAt: number
  expiresAt: number
  revoked: boolean
}

export interface DeviceMeta {
  deviceId?: string
  deviceName?: string
  platform?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}
