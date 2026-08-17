'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  PackagePlus,
  Phone,
  RefreshCw,
  Search,
  User,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { ErrorToast } from '@/components/ErrorToast'
import { OrderIdLink } from '@/components/customer-service/OrderIdLink'
import { CreateShopifyOrderDialog } from '@/components/customer-service/CreateShopifyOrderDialog'
import {
  fetchCareCreatedOrders,
  type CareCreatedOrder,
  type CareCreatedOrdersSummary,
} from '@/lib/careTasksApi'
import { isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import { parseFlexibleDate } from '@/src/utils/orderTimeline'

type PageSize = 20 | 50 | 100
type WhoFilter = 'all' | 'mine'
type PaymentFilter = 'all' | 'cod' | 'prepaid'
type StatusFilter = 'all' | 'active' | 'cancelled'

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100]

function fmtDay(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value) || new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtMoney(currency: string, amount: string) {
  return `${currency || 'INR'} ${amount || '0'}`
}

function badge(tone: 'emerald' | 'blue' | 'purple' | 'amber' | 'muted' | 'red') {
  const map = {
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25',
    purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    muted: 'bg-black/5 dark:bg-white/5 text-[var(--foreground-muted)] border-[var(--border)]',
    red: 'bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/25',
  }
  return `text-[10px] font-bold px-2 py-0.5 rounded border ${map[tone]}`
}

function addressLines(order: CareCreatedOrder) {
  return [
    [order.address1, order.address2].filter(Boolean).join(', '),
    [order.city, order.province, order.zip].filter(Boolean).join(', '),
    order.country,
  ].filter(Boolean)
}

export default function CareCreatedOrdersPage() {
  const { user } = useAuth()
  const isExec = isCareExecutiveRole(user?.role)

  const [orders, setOrders] = useState<CareCreatedOrder[]>([])
  const [summary, setSummary] = useState<CareCreatedOrdersSummary>({
    total: 0,
    mine: 0,
    cod: 0,
    prepaid: 0,
    active: 0,
    cancelled: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [who, setWho] = useState<WhoFilter>('all')
  const [payment, setPayment] = useState<PaymentFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, who, payment, status, pageSize])

  const load = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCareCreatedOrders({
        mine: isExec || who === 'mine',
        search: debouncedSearch || undefined,
        page,
        pageSize,
        payment,
        status,
      })
      setOrders(data.orders)
      setSummary(data.summary)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.totalPages)
      if (data.pagination.page !== page) setPage(data.pagination.page)
    } catch (err: any) {
      setError(err?.message || 'Failed to load care-created orders')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [user, isExec, who, debouncedSearch, page, pageSize, payment, status])

  useEffect(() => {
    void load()
  }, [load])

  const safePage = Math.min(page, Math.max(1, totalPages))
  const start = total === 0 ? 0 : (safePage - 1) * pageSize
  const end = Math.min(start + orders.length, total)

  const selectClass = 'px-2.5 py-1.5 rounded-lg border text-xs font-semibold'
  const selectStyle = {
    background: 'var(--card)',
    borderColor: 'var(--border)',
    color: 'var(--foreground)',
  } as const

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-6xl mx-auto mt-20">
          {!isExec && <SubNav />}

          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
                Care Orders
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                {isExec
                  ? 'Shopify orders you created. Team orders are hidden.'
                  : 'Orders placed on Shopify by customer care executives.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)', background: 'var(--card)' }}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-purple-600 text-white"
              >
                <PackagePlus className="w-4 h-4" />
                New order
              </button>
            </div>
          </div>

          <div
            className="rounded-xl border overflow-hidden mb-4"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            <table className="w-full text-left">
              <thead>
                <tr
                  className="text-[10px] font-bold uppercase tracking-wider border-b"
                  style={{ color: 'var(--foreground-muted)', borderColor: 'var(--border)' }}
                >
                  <th className="px-4 py-2">{isExec ? 'Your orders' : 'All care orders'}</th>
                  {!isExec && <th className="px-4 py-2">Created by me</th>}
                  <th className="px-4 py-2">COD</th>
                  <th className="px-4 py-2">Prepaid</th>
                  <th className="px-4 py-2">Active</th>
                  <th className="px-4 py-2">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-3">
                    <span className="text-xl font-bold tabular-nums">{summary.total.toLocaleString('en-IN')}</span>
                  </td>
                  {!isExec && (
                    <td className="px-4 py-3">
                      <span className="text-xl font-bold tabular-nums text-purple-600 dark:text-purple-300">
                        {summary.mine.toLocaleString('en-IN')}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="text-xl font-bold tabular-nums">{summary.cod.toLocaleString('en-IN')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                      {summary.prepaid.toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xl font-bold tabular-nums">
                      {(summary.active ?? 0).toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xl font-bold tabular-nums text-red-600 dark:text-red-300">
                      {(summary.cancelled ?? 0).toLocaleString('en-IN')}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--foreground-muted)' }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isExec
                    ? 'Search order #, customer, phone, product…'
                    : 'Search order #, customer, phone, product, executive…'
                }
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                style={{
                  background: 'var(--card)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!isExec && (
                <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  Created by
                  <select
                    value={who}
                    onChange={(e) => setWho(e.target.value as WhoFilter)}
                    className={selectClass}
                    style={selectStyle}
                  >
                    <option value="all">All executives</option>
                    <option value="mine">Me</option>
                  </select>
                </label>
              )}
              <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                Payment
                <select
                  value={payment}
                  onChange={(e) => setPayment(e.target.value as PaymentFilter)}
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="all">All</option>
                  <option value="cod">COD</option>
                  <option value="prepaid">Prepaid</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
          </div>

          {loading && !orders.length ? (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--foreground-muted)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading care-created orders…
            </div>
          ) : orders.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--card)' }}
            >
              No care-created Shopify orders found.
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => {
                const lines = addressLines(order)
                const cancelled = Boolean(order.cancelled || order.cancelled_at)
                return (
                  <div
                    key={String(order.id)}
                    className={`crm-card border p-4 ${cancelled ? 'opacity-75' : ''}`}
                    style={{ borderColor: cancelled ? 'rgba(239,68,68,0.35)' : 'var(--border)' }}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                      <div className="md:col-span-3">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          {cancelled && <span className={badge('red')}>Cancelled</span>}
                          <span className={badge(order.payment === 'cod' ? 'amber' : 'emerald')}>
                            {order.payment === 'cod' ? 'COD' : 'Prepaid'}
                          </span>
                          {!cancelled && order.financial_status && (
                            <span className={badge('blue')}>{order.financial_status.replace(/_/g, ' ')}</span>
                          )}
                          {!cancelled && order.fulfillment_status && (
                            <span className={badge('purple')}>{order.fulfillment_status.replace(/_/g, ' ')}</span>
                          )}
                        </div>
                        <p
                          className={`text-sm font-extrabold ${cancelled ? 'line-through' : ''}`}
                          style={{ color: 'var(--foreground)' }}
                        >
                          <OrderIdLink orderId={order.id} orderName={order.name} />
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                          Created {fmtDay(order.created_at)}
                          {cancelled ? ` · cancelled ${fmtDay(order.cancelled_at)}` : ''}
                        </p>
                        {cancelled && order.cancel_reason && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                            Reason: {String(order.cancel_reason).replace(/_/g, ' ')}
                          </p>
                        )}
                        <p className="text-[11px] mt-2 font-semibold" style={{ color: 'var(--foreground)' }}>
                          {fmtMoney(order.currency, order.total_price)}
                        </p>
                      </div>

                      <div className="md:col-span-3">
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          Customer
                        </p>
                        <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--foreground)' }}>
                          <User className="w-3.5 h-3.5 opacity-50" />
                          {order.customerName || '—'}
                        </p>
                        <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                          <Phone className="w-3 h-3" />
                          {order.phone || '—'}
                        </p>
                        {order.email && (
                          <p className="text-[11px] mt-0.5 break-all" style={{ color: 'var(--foreground-muted)' }}>
                            {order.email}
                          </p>
                        )}
                      </div>

                      <div className="md:col-span-3">
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          Ship to
                        </p>
                        {lines.length ? (
                          lines.map((line) => (
                            <p
                              key={line}
                              className="text-[11px] flex items-start gap-1 mt-0.5"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                              {line}
                            </p>
                          ))
                        ) : (
                          <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                            —
                          </p>
                        )}
                      </div>

                      <div className="md:col-span-3">
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          Created by
                        </p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                          {order.createdByName || 'Care executive'}
                        </p>
                        {order.createdByEmail && (
                          <p className="text-[11px] break-all" style={{ color: 'var(--foreground-muted)' }}>
                            {order.createdByEmail}
                          </p>
                        )}
                      </div>
                    </div>

                    {order.lineItems?.length > 0 && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          Items
                        </p>
                        <ul className="space-y-1">
                          {order.lineItems.map((li, idx) => (
                            <li
                              key={`${order.id}-${idx}`}
                              className="text-[12px] flex flex-wrap justify-between gap-2"
                              style={{ color: 'var(--foreground)' }}
                            >
                              <span>
                                {li.quantity}× {li.title}
                                {li.variantTitle ? ` · ${li.variantTitle}` : ''}
                                {li.sku ? (
                                  <span style={{ color: 'var(--foreground-muted)' }}> ({li.sku})</span>
                                ) : null}
                              </span>
                              <span className="tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
                                {fmtMoney(order.currency, li.price)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {order.note && (
                      <p className="mt-2 text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                        Note: {order.note}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div
            className="sticky bottom-3 z-10 mt-4 rounded-xl border p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {total === 0 ? 'No results' : `${start + 1}–${end} of ${total.toLocaleString('en-IN')}`}
            </p>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                  className="px-2 py-1.5 rounded-lg border text-xs"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border disabled:opacity-40"
                style={{ borderColor: 'var(--border)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded-lg border disabled:opacity-40"
                style={{ borderColor: 'var(--border)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>

      <CreateShopifyOrderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        agent={{ name: user?.name, email: user?.email }}
        onCreated={(result) => {
          setCreateOpen(false)
          setSuccess(`Created ${result.orderName || 'order'} on Shopify`)
          void load()
        }}
      />

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 text-sm">
          {success}
          <button className="ml-2 opacity-60" onClick={() => setSuccess(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
