'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Heart, Bell, Menu, X, Check, Trash2, ShoppingBag, Sparkles, BellRing, Sun, Moon, Package, Settings2 } from 'lucide-react'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface AppNotification {
  id: string
  title: string
  body: string
  time: string         // Human-readable relative string (re-computed on render)
  createdAt: number    // Unix timestamp ms — source of truth for FIFO ordering
  unread: boolean
  type: 'order' | 'system' | 'alert'
  orderName?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (diff < 10000) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  if (hrs < 24) return `${hrs} hr ago`
  return `${days} day${days > 1 ? 's' : ''} ago`
}

/** Sort notifications newest-first (FIFO: latest on top) */
function sortNotifications(notifs: AppNotification[]): AppNotification[] {
  return [...notifs].sort((a, b) => b.createdAt - a.createdAt)
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  order: 'Orders',
  system: 'System',
  alert: 'Alerts',
}

export function TopBar() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null)
  const [pulseBell, setPulseBell] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'order' | 'system' | 'alert'>('all')
  const [isDark, setIsDark] = useState(false)  // Default: light (matches layout.tsx inline script)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const baselineIdsRef = useRef<Set<number>>(new Set())

  // ── 0. Initialise theme from document class (set by layout.tsx inline script) ─
  useEffect(() => {
    // Read from document.documentElement instead of localStorage to avoid mismatch
    // The layout.tsx inline script already applied the correct class before hydration
    const dark = document.documentElement.classList.contains('dark')
    setIsDark(dark)
    // Ensure localStorage is in sync
    localStorage.setItem('fiberise_theme', dark ? 'dark' : 'light')
  }, [])

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    const theme = next ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('fiberise_theme', theme)
  }

  // ── 1. Load & FIFO-sort notifications from localStorage ─────────────────
  useEffect(() => {
    const cached = localStorage.getItem('fiberise_notifications')
    if (cached) {
      try {
        const parsed: AppNotification[] = JSON.parse(cached)
        // Migrate old notifications missing createdAt
        const migrated = parsed.map((n) => ({
          ...n,
          createdAt: n.createdAt || Date.now(),
          type: n.type || 'system',
        }))
        // FIFO fix: always sort by createdAt DESC on load
        const sorted = sortNotifications(migrated)
        setNotifications(sorted)
        sorted.forEach((n) => {
          if (n.type === 'order') {
            const id = parseInt(n.id.replace('notif-', ''), 10)
            if (!isNaN(id)) baselineIdsRef.current.add(id)
          }
        })
      } catch {
        // corrupted cache
      }
    } else {
      const now = Date.now()
      const defaults: AppNotification[] = [
        {
          id: 'notif-2',
          title: 'Shopify Sync Active',
          body: 'Successfully connected and listening for live order changes.',
          time: '35 mins ago',
          createdAt: now - 35 * 60 * 1000,
          unread: false,
          type: 'system',
        },
        {
          id: 'notif-1',
          title: 'FCM Service Connected',
          body: 'Google FCM credentials synchronized successfully.',
          time: '10 mins ago',
          createdAt: now - 10 * 60 * 1000,
          unread: true,
          type: 'system',
        },
      ]
      const sorted = sortNotifications(defaults)
      setNotifications(sorted)
      localStorage.setItem('fiberise_notifications', JSON.stringify(sorted))
    }
  }, [])

  // ── 2. Click outside dropdown handler ────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── 3. Silent Shopify Live Polling Listener ───────────────────────────────
  useEffect(() => {
    const checkNewOrders = async (isFirstRun: boolean) => {
      try {
        const res = await fetch('/api/shopify/orders')
        if (!res.ok) return

        const data = await res.json()
        const fetchedOrders = data.orders || []

        if (isFirstRun) {
          fetchedOrders.forEach((o: any) => baselineIdsRef.current.add(o.id))
          return
        }

        const newOrders = fetchedOrders.filter((o: any) => !baselineIdsRef.current.has(o.id))

        if (newOrders.length > 0) {
          newOrders.forEach((newOrder: any) => {
            baselineIdsRef.current.add(newOrder.id)

            const customerName = newOrder.customer
              ? `${newOrder.customer.first_name || ''} ${newOrder.customer.last_name || ''}`.trim()
              : 'Guest Checkout'
            const city = newOrder.shipping_address?.city || 'India'
            const itemTitle = newOrder.line_items?.[0]?.title || 'Products'
            const totalPriceFormatted = `₹${newOrder.total_price}`

            const newNotif: AppNotification = {
              id: `notif-${newOrder.id}`,
              title: `🎉 New Shopify Order ${newOrder.name}`,
              body: `${customerName} from ${city} placed an order for ${itemTitle} (Total: ${totalPriceFormatted})`,
              time: 'Just now',
              createdAt: Date.now(),
              unread: true,
              type: 'order',
              orderName: newOrder.name,
            }

            setNotifications((prev) => {
              if (prev.some((n) => n.id === newNotif.id)) return prev
              // Prepend new notification and re-sort to guarantee FIFO
              const updated = sortNotifications([newNotif, ...prev])
              localStorage.setItem('fiberise_notifications', JSON.stringify(updated))
              return updated
            })

            setPulseBell(true)
            setTimeout(() => setPulseBell(false), 2000)
            setActiveToast(newNotif)

            const event = new CustomEvent('shopify_new_order_received', { detail: newOrder })
            window.dispatchEvent(event)
          })
        }
      } catch (err) {
        console.error('Silent Shopify order poll error:', err)
      }
    }

    checkNewOrders(true).then(() => {
      const interval = setInterval(() => checkNewOrders(false), 15000)
      return () => clearInterval(interval)
    })
  }, [])

  // ── 4. Auto-dismiss active toast after 6.5 seconds ───────────────────────
  useEffect(() => {
    if (activeToast) {
      const timer = setTimeout(() => setActiveToast(null), 6500)
      return () => clearTimeout(timer)
    }
  }, [activeToast])

  // ── 5. Re-compute relative timestamps every minute ────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, time: relativeTime(n.createdAt) }))
      )
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const unreadCount = notifications.filter((n) => n.unread).length

  const filteredNotifications =
    categoryFilter === 'all'
      ? notifications
      : notifications.filter((n) => n.type === categoryFilter)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMarkAllRead = () => {
    const updated = notifications.map((n) => ({ ...n, unread: false }))
    setNotifications(updated)
    localStorage.setItem('fiberise_notifications', JSON.stringify(updated))
  }

  const handleMarkSingleRead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = notifications.map((n) => (n.id === id ? { ...n, unread: false } : n))
    setNotifications(updated)
    localStorage.setItem('fiberise_notifications', JSON.stringify(updated))
  }

  const handleClearAll = () => {
    setNotifications([])
    localStorage.setItem('fiberise_notifications', JSON.stringify([]))
    setShowDropdown(false)
  }

  const typeIcon = (type: string) => {
    if (type === 'order') return <ShoppingBag className="w-4 h-4" />
    if (type === 'alert') return <BellRing className="w-4 h-4" />
    return <Settings2 className="w-4 h-4" />
  }

  const typeColors = (type: string) => {
    if (type === 'order') return 'bg-purple-500/10 border-purple-500/20 text-purple-400'
    if (type === 'alert') return 'bg-red-500/10 border-red-500/20 text-red-400'
    return 'bg-blue-500/10 border-blue-500/20 text-blue-400'
  }

  return (
    <>
      <header className="fixed top-0 right-0 left-0 lg:left-64 h-16 bg-[#0e121a]/90 dark:bg-[#0e121a]/90 light:bg-white/90 backdrop-blur-lg border-b border-white/10 dark:border-white/10 flex items-center justify-between px-4 lg:px-6 z-30 shadow-lg select-none transition-colors duration-300">

        {/* Mobile menu trigger + Page Title */}
        <div className="flex items-center gap-4">
          <button className="lg:hidden text-white/60 hover:text-white transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-xs text-white/40 font-semibold">Live Sync Active</span>
          </div>
        </div>

        {/* Global Nav Tools */}
        <div className="flex items-center gap-2">

          {/* 🌙/☀️ THEME TOGGLE */}
          <button
            onClick={toggleTheme}
            className="relative text-white/60 hover:text-white transition-all duration-300 p-2 rounded-lg hover:bg-white/5 group"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <div className="relative w-5 h-5">
              <Sun
                className={`w-5 h-5 absolute transition-all duration-300 ${
                  isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100 text-amber-400'
                }`}
              />
              <Moon
                className={`w-5 h-5 absolute transition-all duration-300 ${
                  isDark ? 'opacity-100 rotate-0 scale-100 text-purple-300' : 'opacity-0 -rotate-90 scale-50'
                }`}
              />
            </div>
          </button>

          {/* ❤️ Favorites */}
          <button className="text-white/60 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5">
            <Heart className="w-5 h-5" />
          </button>

          {/* 🔔 LIVE BELL ICON CONTAINER */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className={`relative text-white/60 hover:text-white transition-all duration-300 p-2 rounded-lg hover:bg-white/5 ${
                pulseBell ? 'scale-110 text-purple-400' : ''
              }`}
            >
              {pulseBell ? (
                <BellRing className="w-5 h-5 text-purple-400 animate-bounce" />
              ) : (
                <Bell className={`w-5 h-5 ${unreadCount > 0 ? 'text-purple-300' : ''}`} />
              )}

              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-md shadow-purple-500/20 border border-[#0e121a] animate-pulse">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* ── GLASSMORPHIC NOTIFICATION DROPDOWN ── */}
            {showDropdown && (
              <div className="absolute right-0 mt-3 w-96 bg-[#0e121a] border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl z-50 overflow-hidden">

                {/* Dropdown Header */}
                <div className="flex items-center justify-between px-4 py-3.5 bg-white/5 border-b border-white/10">
                  <div className="flex items-center gap-2 font-bold text-white text-sm">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    Notifications
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[9px] font-extrabold">
                        {unreadCount} NEW
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[10px] text-purple-400 hover:text-purple-300 font-extrabold uppercase tracking-wide transition-colors flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Mark all read
                    </button>
                  )}
                </div>

                {/* Category Filter Tabs */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 bg-white/3">
                  {(['all', 'order', 'system', 'alert'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                        categoryFilter === cat
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                {/* Notifications Scrollable List */}
                <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                  {filteredNotifications.length === 0 ? (
                    <div className="py-12 text-center">
                      <Bell className="w-8 h-8 text-white/10 mx-auto mb-3" />
                      <p className="text-white/40 text-xs font-semibold">No notifications here.</p>
                    </div>
                  ) : (
                    filteredNotifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          const updated = notifications.map((item) =>
                            item.id === n.id ? { ...item, unread: false } : item
                          )
                          setNotifications(updated)
                          localStorage.setItem('fiberise_notifications', JSON.stringify(updated))
                        }}
                        className={`p-4 text-left transition-colors cursor-pointer flex gap-3 items-start ${
                          n.unread ? 'bg-purple-950/15 hover:bg-purple-950/20' : 'hover:bg-white/5'
                        }`}
                      >
                        {/* Type icon */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${typeColors(n.type)}`}>
                          {typeIcon(n.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-xs truncate font-bold ${n.unread ? 'text-purple-200' : 'text-white'}`}>
                              {n.title}
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {n.unread && (
                                <button
                                  onClick={(e) => handleMarkSingleRead(n.id, e)}
                                  className="w-4 h-4 rounded bg-purple-500/20 border border-purple-500/30 hover:bg-purple-500/30 flex items-center justify-center text-purple-300 shrink-0"
                                  title="Mark as read"
                                >
                                  <Check className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-white/50 leading-relaxed font-normal mt-0.5 line-clamp-2">
                            {n.body}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[9px] text-white/30 font-semibold">
                              {relativeTime(n.createdAt)}
                            </span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                              n.type === 'order' ? 'bg-purple-500/10 text-purple-400' :
                              n.type === 'alert' ? 'bg-red-500/10 text-red-400' :
                              'bg-blue-500/10 text-blue-400'
                            }`}>
                              {n.type}
                            </span>
                          </div>
                        </div>

                        {/* Unread indicator dot */}
                        {n.unread && (
                          <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0 mt-1 animate-pulse" />
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Dropdown Footer */}
                {notifications.length > 0 && (
                  <div className="p-2 border-t border-white/10 bg-white/5 flex items-center justify-between">
                    <span className="text-[9px] text-white/30 font-semibold ml-2">
                      {notifications.length} total • Sorted newest first
                    </span>
                    <button
                      onClick={handleClearAll}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 text-[10px] font-extrabold uppercase transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </header>

      {/* ── 🚀 LIVE VIEWPORT ORDER TOAST NOTIFICATION OVERLAY ── */}
      {activeToast && (
        <div className="fixed top-20 right-4 lg:right-6 z-[9999] w-full max-w-sm bg-[#0e121a]/95 border border-purple-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-md select-none animate-in slide-in-from-right-4 duration-300">
          <div className="flex gap-3.5 items-start">

            <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center border border-purple-500/30 shrink-0 text-purple-300 relative shadow-inner">
              <Package className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#0e121a]"></span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  New Shopify Order
                </span>
                <button
                  onClick={() => setActiveToast(null)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs font-bold text-purple-300 mt-1">{activeToast.title}</p>
              <p className="text-xs text-white/70 leading-normal font-semibold mt-1">
                {activeToast.body}
              </p>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                <button
                  onClick={() => {
                    setActiveToast(null)
                    const ev = new CustomEvent('shopify_view_live_order', { detail: activeToast.orderName })
                    window.dispatchEvent(ev)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-[10px] font-extrabold text-white transition-colors"
                >
                  View Order
                </button>
                <button
                  onClick={() => setActiveToast(null)}
                  className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-[10px] font-bold text-white/60 hover:text-white transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
