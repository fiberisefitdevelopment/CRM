'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  homePathForRole,
  isCareExecutiveRole,
  isPathAllowedForRole,
} from '@/src/utils/accessControl'
import { apiFetch, ensureFreshToken } from './apiFetch'
import {
  clearLegacyAuthCookie,
  clearTokens,
  getAccessToken,
  getOrCreateDeviceId,
  getRefreshToken,
  setTokens,
} from './tokenStore'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  ipAddress?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: (allDevices?: boolean) => Promise<void>
  refreshUser: () => Promise<AuthUser | null>
  apiFetch: typeof apiFetch
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchMe(): Promise<AuthUser | null> {
  const token = getAccessToken()
  if (!token) return null
  const res = await apiFetch('/api/auth/me', { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.authenticated || !data.user) return null
  return data.user as AuthUser
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  const refreshUser = useCallback(async () => {
    const me = await fetchMe()
    setUser(me)
    return me
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      clearLegacyAuthCookie()
      try {
        if (!getAccessToken() && getRefreshToken()) {
          await ensureFreshToken()
        }
        if (!getAccessToken() && !getRefreshToken()) {
          if (!cancelled) {
            setUser(null)
            setLoading(false)
          }
          return
        }
        const me = await fetchMe()
        if (!cancelled) setUser(me)
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    if (pathname === '/login') {
      if (user) {
        router.replace(homePathForRole(user.role))
      }
      return
    }

    if (!user) {
      router.replace('/login')
      return
    }

    if (isCareExecutiveRole(user.role) && !isPathAllowedForRole(user.role, pathname)) {
      router.replace(homePathForRole(user.role))
    }
  }, [loading, user, pathname, router])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        deviceId: getOrCreateDeviceId(),
        platform: 'web',
        deviceName:
          typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'CRM Web',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || 'Invalid credentials or connection error.')
    }
    setTokens(data.accessToken, data.refreshToken)
    const me = (await fetchMe()) || (data.user as AuthUser)
    setUser(me)
    return me
  }, [])

  const logout = useCallback(async (allDevices = false) => {
    const refreshToken = getRefreshToken()
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
        },
        body: JSON.stringify({ refreshToken, allDevices }),
      })
    } catch {
      // still clear local tokens
    }
    clearTokens()
    setUser(null)
    router.replace('/login')
  }, [router])

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      apiFetch,
    }),
    [user, loading, login, logout, refreshUser],
  )

  // Avoid flashing protected UI before auth bootstrap / redirect
  if (pathname !== '/login' && (loading || !user)) {
    return (
      <AuthContext.Provider value={value}>
        <div className="min-h-screen w-full flex items-center justify-center bg-theme">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AuthContext.Provider>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
