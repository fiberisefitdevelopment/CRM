'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert
} from 'lucide-react'
import { homePathForRole } from '@/src/utils/accessControl'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.authenticated) {
          router.replace(homePathForRole(data.user?.role))
          return
        }
      } catch {
        // Not authenticated, show login
      } finally {
        setCheckingAuth(false)
      }

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        if (params.get('reason') === 'concurrent_login') {
          setError('Session Terminated: This account has logged in from another device/browser.')
        }
      }
    }

    checkExistingSession()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please fill in all fields.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || 'Invalid credentials or connection error.')
      }

      setSuccess('Access verified. Redirecting to dashboard...')

      setTimeout(() => {
        router.replace(homePathForRole(data.user?.role))
      }, 400)
    } catch (err: any) {
      setError(err.message || 'Failed to connect to authentication server.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen w-full bg-theme flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-theme text-theme flex items-center justify-center p-4 relative overflow-hidden select-none">

      {/* Background accents */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-purple-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-pink-600/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md z-10">

        {/* Brand header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center justify-center mb-5">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-2xl shadow-purple-500/30">
                <svg viewBox="0 0 32 32" className="w-9 h-9" fill="none">
                  <path d="M8 24 L16 8 L24 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M11 19 L21 19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  <circle cx="16" cy="8" r="2.5" fill="white"/>
                </svg>
              </div>
              <span
                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2"
                style={{ borderColor: 'var(--background)' }}
              />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight heading-gradient mb-1">
            Fiberise Fit
          </h1>
          <p className="text-muted text-xs font-semibold uppercase tracking-widest">
            Secure Administrator Access
          </p>
        </div>

        {/* Login card */}
        <div className="crm-card p-6 lg:p-8 shadow-2xl animate-scale-up">

          {error && (
            <div className="mb-5 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300 text-xs font-semibold flex items-start gap-2.5 animate-slide-down">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-5 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-start gap-2.5 animate-slide-down">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted font-bold uppercase tracking-wider ml-1">
                Administrator Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted opacity-60" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@fiberisefit.com"
                  className="crm-input w-full pl-10 pr-4 py-3 text-sm"
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted font-bold uppercase tracking-wider ml-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted opacity-60" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="crm-input w-full pl-10 pr-10 py-3 text-sm"
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-theme transition-colors"
                  disabled={loading}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-1 select-none">
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-theme bg-elevated w-4 h-4 transition-all cursor-pointer accent-purple-600 focus:ring-0 focus:ring-offset-0 focus:outline-none"
                  disabled={loading}
                />
                <span className="text-xs text-muted group-hover:text-theme transition-colors font-medium">
                  Remember me for 30 days
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Credentials...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </button>
          </form>

        </div>

        <div className="text-center mt-8 text-[10px] text-muted opacity-70 font-semibold tracking-wider uppercase animate-fade-in flex items-center justify-center gap-1.5 select-none">
          <ShieldAlert className="w-3.5 h-3.5" />
          Authorized personnel only • Secured by Firebase
        </div>

      </div>
    </div>
  )
}
