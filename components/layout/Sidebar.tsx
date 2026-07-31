'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bell,
  ShoppingBag,
  PackagePlus,
  LogOut,
  TrendingUp,
  ShieldCheck,
  ChevronLeft,
  Menu,
  Route,
  PackageSearch,
  Headphones,
  Plane,
  Megaphone,
} from 'lucide-react'

const menuItems = [
  { icon: PackageSearch, label: 'Order Status', href: '/order-status' },
  { icon: ShoppingBag,    label: 'Orders', href: '/orders' },
  { icon: PackagePlus,   label: 'Create Order', href: '/shiprocket/create-order' },
  { icon: Headphones,    label: 'Customer Service', href: '/customer-service' },
  { icon: TrendingUp,    label: 'Sales Analytics', href: '/sales-dashboard' },
  { icon: Route,         label: 'Customer Journey', href: '/crm/customer-journeys' },
  { icon: Plane,         label: 'Air Express', href: '/air-express' },
  { icon: Megaphone,     label: 'Meta Analytics', href: '/meta-analytics' },
  { icon: Bell,          label: 'Advertisements', href: '/notifications' },
  { icon: ShieldCheck,   label: 'Audit Logs', href: '/audit-logs' },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<{ email: string; role: string; ipAddress?: string } | null>(null)
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.replace('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  // 1. Initialise sidebar state from localStorage
  useEffect(() => {
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true'
    setCollapsed(isCollapsed)
    if (isCollapsed) {
      document.documentElement.setAttribute('data-sidebar-collapsed', 'true')
    } else {
      document.documentElement.removeAttribute('data-sidebar-collapsed')
    }
  }, [])

  // 2. Fetch and monitor auth session state
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data.authenticated) {
          if (data.error && data.error.includes('Another login was detected')) {
            router.replace('/login?reason=concurrent_login')
          } else {
            router.replace('/login')
          }
        } else {
          setUser(data.user)
        }
      } catch (err) {
        console.error('Failed to run auth check:', err)
      }
    }

    checkAuth()
    const interval = setInterval(checkAuth, 10000)
    return () => clearInterval(interval)
  }, [router])

  const handleToggle = () => {
    const nextCollapsed = !collapsed
    setCollapsed(nextCollapsed)
    localStorage.setItem('sidebar_collapsed', String(nextCollapsed))
    if (nextCollapsed) {
      document.documentElement.setAttribute('data-sidebar-collapsed', 'true')
    } else {
      document.documentElement.removeAttribute('data-sidebar-collapsed')
    }
  }

  const visibleMenuItems = menuItems.filter((item) => {
    if (item.label === 'Audit Logs') {
      return user?.role === 'admin' || user?.role === 'super_admin'
    }
    return true
  })

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <aside
      className={`fixed left-0 top-0 h-full border-r transition-all duration-300 z-40 hidden lg:flex flex-col ${
        collapsed ? 'w-20' : 'w-64'
      }`}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
      }}
    >
      {/* ── Logo / Brand Header ── */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--sidebar-border)', minHeight: '64px' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            {/* Fiberise Logo Mark */}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20 shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path d="M6 18 L12 6 L18 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8.5 14.5 L15.5 14.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="12" cy="6" r="1.8" fill="white"/>
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-extrabold text-sm tracking-tight" style={{ color: 'var(--foreground)' }}>
                Fiberise Fit
              </span>
              {user && (
                <span className="text-[9px] font-bold capitalize mt-0.5 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-500 w-fit">
                  {user.role.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-full flex justify-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path d="M6 18 L12 6 L18 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8.5 14.5 L15.5 14.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="12" cy="6" r="1.8" fill="white"/>
              </svg>
            </div>
          </div>
        )}
        <button
          onClick={handleToggle}
          className="p-1.5 rounded-lg transition-all hover:scale-110"
          style={{ color: 'var(--foreground-muted)' }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <Menu className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-none">
        {visibleMenuItems.map((item, index) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={index}
              href={item.href}
              prefetch={false}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative ${
                active
                  ? 'sidebar-active font-semibold'
                  : 'sidebar-hover'
              }`}
              style={
                active
                  ? {
                      backgroundColor: 'var(--sidebar-active-bg)',
                      borderColor: 'var(--sidebar-active-border)',
                      color: 'var(--sidebar-text-active)',
                      border: '1px solid var(--sidebar-active-border)',
                    }
                  : {
                      color: 'var(--sidebar-text)',
                    }
              }
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--sidebar-hover-bg)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--foreground)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text)'
                }
              }}
            >
              {/* Active left indicator */}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-purple-500 rounded-full" />
              )}
              <Icon className="w-4.5 h-4.5 flex-shrink-0 w-[18px] h-[18px]" />
              {!collapsed && (
                <span className="text-sm font-medium truncate">{item.label}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* ── Super Admin IP HUD ── */}
      {user?.role === 'super_admin' && (
        <div className="px-3 py-2">
          {!collapsed ? (
            <div className="p-3 rounded-xl border relative overflow-hidden select-none"
              style={{ backgroundColor: 'rgba(220, 38, 38, 0.05)', borderColor: 'rgba(220, 38, 38, 0.2)' }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[9px] text-red-400 font-extrabold tracking-widest uppercase font-mono">
                  IP TRACING HUD
                </span>
              </div>
              <div className="space-y-1 font-mono text-[9px]">
                <div className="flex justify-between" style={{ color: 'var(--foreground-muted)' }}>
                  <span>Logged IP:</span>
                  <span className="text-red-400 font-bold">{user.ipAddress || '127.0.0.1'}</span>
                </div>
                <div className="flex justify-between" style={{ color: 'var(--foreground-muted)' }}>
                  <span>Telemetry:</span>
                  <span className="text-emerald-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                    Active
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center p-2 rounded-xl" style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)' }}>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── User Info & Logout ── */}
      <div className="p-3 border-t select-none" style={{ borderColor: 'var(--sidebar-border)' }}>
        {!collapsed && user && (
          <div className="px-3 py-2 mb-2 rounded-lg" style={{ backgroundColor: 'var(--sidebar-hover-bg)' }}>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--foreground)' }}>
              {user.email}
            </p>
            <p className="text-[10px] capitalize" style={{ color: 'var(--foreground-muted)' }}>
              {user.role.replace('_', ' ')}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-red-500 hover:bg-red-500/10 cursor-pointer text-left focus:outline-none"
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
        </button>
      </div>
    </aside>
  )
}
