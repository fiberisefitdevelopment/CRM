/**
 * CRM auth — JWT access + rotating refresh tokens (HS256 via jose).
 *
 * Login: email/password against Firestore `users`
 * Tokens: access (1h) + refresh (30d, hashed in `refresh_tokens`)
 * APIs: `Authorization: Bearer <access_token>` only
 */

export type {
  AuthUser,
  SessionData,
  DeviceMeta,
  TokenPair,
  RefreshTokenRecord,
} from './types'
export {
  AUTH_HEADER,
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
} from './types'

export { hashPassword, verifyPassword } from './passwords'
export {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from './tokens'
export {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  findValidRefreshRecord,
} from './refreshStore'
export { getAuthFromRequest, getBearerToken } from './getAuth'
export {
  requireAuth,
  requireRole,
  optionalAuth,
  authErrorResponse,
  AuthError,
  loadUserByEmail,
} from './guards'
export {
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthFailures,
  getClientIp,
} from './rateLimit'
export { seedAdminUser } from './seed'
