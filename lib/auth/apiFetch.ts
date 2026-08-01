'use client'

import {
  clearTokens,
  getAccessToken,
  getOrCreateDeviceId,
  getRefreshToken,
  setTokens,
} from './tokenStore'

let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken,
        deviceId: getOrCreateDeviceId(),
        platform: 'web',
        deviceName: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'web',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.accessToken || !data.refreshToken) {
      clearTokens()
      return false
    }
    setTokens(data.accessToken, data.refreshToken)
    return true
  } catch {
    clearTokens()
    return false
  }
}

/** Single-flight refresh so parallel 401s only rotate once. */
export function ensureFreshToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function isAuthEndpoint(url: string): boolean {
  return (
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/refresh') ||
    url.includes('/api/auth/logout')
  )
}

/**
 * fetch() wrapper that attaches Bearer access token and silently refreshes on 401.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init?.headers || {})

  if (!isAuthEndpoint(url)) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  let res = await fetch(input, { ...init, headers })

  if (res.status !== 401 || isAuthEndpoint(url)) {
    return res
  }

  const refreshed = await ensureFreshToken()
  if (!refreshed) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    return res
  }

  const retryHeaders = new Headers(init?.headers || {})
  const nextToken = getAccessToken()
  if (nextToken) retryHeaders.set('Authorization', `Bearer ${nextToken}`)
  return fetch(input, { ...init, headers: retryHeaders })
}
