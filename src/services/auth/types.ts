export interface AuthUser {
  email: string
  role: string
  sessionId?: string
  expiresAt: number
}

/** @deprecated use AuthUser — kept for older imports */
export type SessionData = AuthUser

export const AUTH_COOKIE = 'fiberise_session'
export const AUTH_HEADER = 'authorization'
