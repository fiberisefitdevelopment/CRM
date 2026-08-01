const REFRESH_KEY = 'fiberise_refresh_token'
const DEVICE_KEY = 'fiberise_device_id'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch {
    // ignore quota / private mode
  }
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server'
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export function setTokens(access: string, refresh: string): void {
  setAccessToken(access)
  setRefreshToken(refresh)
}

export function clearTokens(): void {
  setAccessToken(null)
  setRefreshToken(null)
}

/** Clear legacy cookie if still present from old auth. */
export function clearLegacyAuthCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie =
    'fiberise_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
}
