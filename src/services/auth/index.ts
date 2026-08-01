/**
 * CRM auth — JWT access tokens (HS256 via jose).
 *
 * Login: email/password against Firestore `users`
 * Token: returned as `accessToken` + HTTP-only cookie `fiberise_session`
 * APIs: accept `Authorization: Bearer <token>` or the cookie
 */

export type { AuthUser, SessionData } from './types'
export { AUTH_COOKIE } from './types'

export { hashPassword, verifyPassword } from './passwords'
export {
  signAccessToken,
  verifyAccessToken,
  encryptSession,
  decryptSession,
} from './tokens'
export { validateSession } from './sessionStore'
export { getAuthFromRequest, getBearerToken } from './getAuth'
export { seedAdminUser } from './seed'
