'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { isCodOrder, getPaymentLabel } from '@/src/utils/orderPayment'
import {
  TrendingUp, ShoppingBag, DollarSign, CreditCard, Truck, RefreshCw,
  Loader2, AlertCircle, Award, ChevronRight, Sparkles, TrendingDown,
  Coins, FileSpreadsheet, Search, MapPin, Users, BarChart2, X,
  Download, CheckCircle, XCircle, Clock, Package, ArrowUpRight,
  ArrowDownRight, Globe, Filter, Tag, Calendar
} from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line, Area, AreaChart } from 'recharts'

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface LineItem {
  id: number; title: string; variant_title: string | null
  sku: string | null; quantity: number; price: string
  total_discount: string; fulfillment_status: string | null
}
interface Address {
  first_name?: string; last_name?: string; address1?: string
  city?: string; province?: string; country?: string; zip?: string; phone?: string
}
interface ShopifyOrder {
  id: number; name: string; created_at: string
  financial_status: string; payment_method?: string | null
  fulfillment_status: string | null
  total_price: string; currency: string; cancelled_at?: string | null
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string } | null
  shipping_address?: Address | null; billing_address?: Address | null
  line_items: LineItem[]
  fulfillments?: Array<{ id: number; status: string; tracking_number: string | null
    tracking_company: string | null; tracking_url: string | null
    shipment_status: string | null; created_at: string
    dispatch_date?: string | null; delivery_date?: string | null }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtNum = (n: number) => new Intl.NumberFormat('en-IN').format(n)

function isOrderCancelled(o: ShopifyOrder): boolean {
  return (
    !!o.cancelled_at ||
    o.financial_status?.toLowerCase() === 'voided' ||
    o.financial_status?.toLowerCase() === 'cancelled' ||
    o.financial_status?.toLowerCase() === 'refunded' ||
    o.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

function getShipStatus(o: ShopifyOrder): string {
  return (o.fulfillments?.[0]?.shipment_status || '').toLowerCase()
}

/** Local YYYY-MM-DD for an order timestamp (handles ISO + "27 Jul 2026, 11:53 AM"). */
function toDayKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10)
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localTodayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDaysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub?: string
  icon: any; color: string; trend?: { dir: 'up' | 'down'; text: string }
}) {
  return (
    <div className={`crm-card p-5 relative overflow-hidden group hover:shadow-card-lg transition-all duration-300 hover:-translate-y-0.5`}>
      <div className={`absolute top-0 right-0 w-28 h-28 rounded-full blur-3xl opacity-30 group-hover:opacity-50 transition-opacity ${color}`} />
      <div className="flex justify-between items-start relative">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--foreground-muted)' }}>{label}</p>
          <h3 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--foreground)' }}>{value}</h3>
          {trend && (
            <p className={`text-[10px] font-semibold mt-1.5 flex items-center gap-1 ${trend.dir === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
              {trend.dir === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {trend.text}
            </p>
          )}
          {sub && !trend && <p className="text-[10px] mt-1.5" style={{ color: 'var(--foreground-muted)' }}>{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${color.replace('bg-', 'bg-').replace('/10', '/15').replace('text-', 'border-').replace('/10', '/25')} ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="crm-card p-5 space-y-3">
      <div className="skeleton h-3 w-24 rounded" />
      <div className="skeleton h-7 w-32 rounded" />
      <div className="skeleton h-2 w-20 rounded" />
    </div>
  )
}

// ─── COD Remittance Table ─────────────────────────────────────────────────────
function CODTable({ orders }: { orders: ShopifyOrder[] }) {
  const [search, setSearch] = useState('')
  const [remittanceFilter, setRemittanceFilter] = useState('all')
  const [logisticsFilter, setLogisticsFilter] = useState('all')

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (isOrderCancelled(o)) return false
      if (!isCodOrder(o)) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = (o.name || '').toLowerCase()
        const cust = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.toLowerCase() : ''
        if (!name.includes(q) && !cust.includes(q)) return false
      }
      const status = getShipStatus(o)
      if (remittanceFilter !== 'all') {
        if (!o.fulfillment_status && remittanceFilter !== 'pending') return false
        if (o.fulfillment_status) {
          if (status === 'delivered' && remittanceFilter !== 'settled') return false
          if (['failure','rto','returned'].includes(status) && remittanceFilter !== 'rto') return false
          if (!['delivered','failure','rto','returned'].includes(status) && remittanceFilter !== 'pending') return false
        }
      }
      if (logisticsFilter !== 'all') {
        if (!o.fulfillment_status && logisticsFilter !== 'unfulfilled') return false
        if (o.fulfillment_status) {
          if (status === 'delivered' && logisticsFilter !== 'delivered') return false
          if (['failure','rto','returned'].includes(status) && logisticsFilter !== 'rto') return false
          if (['in_transit','out_for_delivery','attempted_delivery'].includes(status) && logisticsFilter !== 'transit') return false
          if (!['delivered','failure','rto','returned','in_transit','out_for_delivery','attempted_delivery'].includes(status) && logisticsFilter !== 'scheduled') return false
        }
      }
      return true
    })
  }, [orders, search, remittanceFilter, logisticsFilter])

  const exportCSV = () => {
    const header = 'Order,Customer,City,State,Pincode,Amount,Logistics,Remittance,Dispatch Date,Delivery Date'
    const rows = filtered.map((o) => {
      const cust = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'Guest'
      const status = getShipStatus(o)
      const remit = !o.fulfillment_status ? 'Pending' : status === 'delivered' ? 'Settled' : ['failure','rto','returned'].includes(status) ? 'RTO Unrealized' : 'Pending'
      
      const latestFulfillment = (o.fulfillments?.[0] || {}) as any
      const dispatchDate = o.fulfillment_status ? (latestFulfillment.dispatch_date || latestFulfillment.created_at || '') : ''
      const deliveryDate = status === 'delivered' ? (latestFulfillment.delivery_date || latestFulfillment.created_at || '') : ''
      
      return `${o.name},"${cust}","${o.shipping_address?.city||''}","${o.shipping_address?.province||''}","${o.shipping_address?.zip||''}",${o.total_price},${status||'Unfulfilled'},${remit},"${dispatchDate}","${deliveryDate}"`
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'cod_remittance.csv'; a.click()
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--foreground)' }}>
          <FileSpreadsheet className="w-4 h-4 text-purple-500" />
          COD Remittance Ledger
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: 'var(--accent-purple-light)', color: 'var(--accent-purple)' }}>
            {filtered.length} records
          </span>
        </h3>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg w-48 crm-input" />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--foreground-muted)' }} />
          </div>
          <select value={remittanceFilter} onChange={e => setRemittanceFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg crm-input cursor-pointer">
            <option value="all">All Remittance</option>
            <option value="settled">Settled</option>
            <option value="pending">Pending</option>
            <option value="rto">RTO</option>
          </select>
          <select value={logisticsFilter} onChange={e => setLogisticsFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg crm-input cursor-pointer">
            <option value="all">All Logistics</option>
            <option value="unfulfilled">Unfulfilled</option>
            <option value="scheduled">Scheduled</option>
            <option value="transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="rto">RTO</option>
          </select>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', maxHeight: '380px', overflowY: 'auto' }}>
        <table className="min-w-full text-xs text-left">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--card-elevated)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Order','Customer','Location','Amount','Logistics Status','Remittance'].map(h => (
                <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>No COD orders match the selected filters.</td></tr>
            ) : filtered.map((o) => {
              const cust = o.customer ? `${o.customer.first_name||''} ${o.customer.last_name||''}`.trim() : 'Guest Checkout'
              const status = getShipStatus(o)
              let logLabel = 'Unfulfilled', logClass = 'badge-info'
              let remLabel = 'Pending', remClass = 'badge-warning'
              if (o.fulfillment_status) {
                if (status === 'delivered') { logLabel = 'Delivered'; logClass = 'badge-success'; remLabel = 'Settled'; remClass = 'badge-success' }
                else if (['failure','rto','returned'].includes(status)) { logLabel = 'RTO'; logClass = 'badge-danger'; remLabel = 'RTO Unrealized'; remClass = 'badge-danger' }
                else { logLabel = status ? status.replace('_',' ') : 'In Transit'; logClass = 'badge-warning' }
              }
              return (
                <tr key={o.id} className="transition-colors hover:bg-purple-500/5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="px-4 py-3 font-bold text-purple-500">{o.name}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--foreground)' }}>{cust}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--foreground-muted)' }}>
                    <div className="text-xs">{o.shipping_address?.city || '–'}</div>
                    <div className="text-[10px] opacity-60">{o.shipping_address?.province || ''} {o.shipping_address?.zip ? `· ${o.shipping_address.zip}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--foreground)' }}>₹{parseFloat(o.total_price||'0').toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${logClass}`}>{logLabel}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${remClass}`}>{remLabel}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Zone Map Component ───────────────────────────────────────────────────────
function ZoneAnalyticsSection() {
  const [zones, setZones] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeZone, setActiveZone] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; zone: any } | null>(null)

  useEffect(() => {
    fetch('/api/shopify/zone-analytics')
      .then(r => r.json())
      .then(d => { setZones(d.zones || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const maxOrders = Math.max(...zones.map(z => z.orderCount), 1)

  const ZONE_ICONS: Record<string, string> = {
    'North': '🏔️', 'South': '🌴', 'East': '🌊', 'West': '🏜️', 'Central': '🌾', 'North-East': '🍃'
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {zones.map((z) => {
          const intensity = maxOrders > 0 ? (z.orderCount / maxOrders) : 0
          const isActive = activeZone === z.zone
          return (
            <button
              key={z.zone}
              onClick={() => setActiveZone(isActive ? null : z.zone)}
              className={`crm-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg ${isActive ? 'ring-2 ring-purple-500' : ''}`}
              style={isActive ? { borderColor: z.color + '60' } : {}}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ZONE_ICONS[z.zone]}</span>
                  <span className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>{z.zone}</span>
                </div>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color, opacity: 0.3 + intensity * 0.7 }} />
              </div>

              {/* Heat bar */}
              <div className="w-full h-1.5 rounded-full mb-3 overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${intensity * 100}%`, backgroundColor: z.color }} />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--foreground-muted)' }}>Orders</span>
                  <span className="font-bold" style={{ color: 'var(--foreground)' }}>{fmtNum(z.orderCount)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--foreground-muted)' }}>Revenue</span>
                  <span className="font-bold text-emerald-600">{fmt(z.revenue)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span style={{ color: 'var(--foreground-muted)' }}>Delivery Rate</span>
                  <span className="font-semibold" style={{ color: z.deliveryRate > 60 ? '#059669' : '#D97706' }}>{z.deliveryRate}%</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Expanded zone detail */}
      {activeZone && (() => {
        const z = zones.find(z => z.zone === activeZone)
        if (!z) return null
        return (
          <div className="crm-card p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-base" style={{ color: 'var(--foreground)' }}>
                {ZONE_ICONS[z.zone]} {z.zone} Zone — State Breakdown
              </h4>
              <button onClick={() => setActiveZone(null)}>
                <X className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--card-elevated)' }}>
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>Total Orders</p>
                <p className="text-xl font-extrabold" style={{ color: 'var(--foreground)' }}>{z.orderCount}</p>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--card-elevated)' }}>
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>Revenue</p>
                <p className="text-lg font-extrabold text-emerald-600">{fmt(z.revenue)}</p>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--card-elevated)' }}>
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>COD %</p>
                <p className="text-xl font-extrabold text-amber-500">{z.codPct}%</p>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--card-elevated)' }}>
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>RTO %</p>
                <p className="text-xl font-extrabold text-red-500">{z.rtoPct}%</p>
              </div>
            </div>
            {z.topStates?.length > 0 && (
              <div className="space-y-2">
                {z.topStates.map((s: any) => (
                  <div key={s.state} className="flex items-center gap-3 text-xs">
                    <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: z.color }} />
                    <span className="flex-1 font-medium" style={{ color: 'var(--foreground)' }}>{s.state}</span>
                    <span style={{ color: 'var(--foreground-muted)' }}>{s.orderCount} orders</span>
                    <span className="font-bold text-emerald-600">{fmt(s.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Gender Analytics ─────────────────────────────────────────────────────────
function GenderAnalyticsSection({ orders, refreshTrigger }: { orders: ShopifyOrder[], refreshTrigger: number }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const syncTimeoutRef = useRef<any>(null)

  const fetchGenderAnalytics = useCallback(async (isRefresh = false) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = null
    }

    try {
      setLoading(true)
      const url = isRefresh
        ? '/api/shopify/gender-analytics?refresh=true'
        : '/api/shopify/gender-analytics'

      const res = await fetch(url)
      const d = await res.json()

      if (d.syncing) {
        setSyncing(true)
        syncTimeoutRef.current = setTimeout(() => {
          fetchGenderAnalytics(isRefresh)
        }, 2000)
        return
      }

      setSyncing(false)
      setData(d)
    } catch {
      setSyncing(false)
    } finally {
      if (!syncTimeoutRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (orders.length === 0) return

    fetchGenderAnalytics(refreshTrigger > 0)

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [orders, refreshTrigger, fetchGenderAnalytics])

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="crm-card p-6 h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (!data?.summary) return null

  const { male, female } = data.summary
  const pieData = [
    { name: 'Male', value: male.orderCount, color: '#2563EB' },
    { name: 'Female', value: female.orderCount, color: '#EC4899' },
  ].filter(d => d.value > 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Pie Chart */}
      <div className="crm-card p-6">
        <h4 className="font-bold text-sm mb-4" style={{ color: 'var(--foreground)' }}>Gender Split (by Orders)</h4>
        {pieData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No gender data available yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                dataKey="value" paddingAngle={3}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: any) => [v + ' orders', '']} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stat cards */}
      <div className="space-y-3">
        {[
          { label: 'Male Customers', d: male, color: '#2563EB', bg: 'rgba(37,99,235,0.08)', icon: '👨' },
          { label: 'Female Customers', d: female, color: '#EC4899', bg: 'rgba(236,72,153,0.08)', icon: '👩' },
        ].map(({ label, d, color, bg, icon }) => (
          <div key={label} className="crm-card p-4 flex items-center gap-4">
            <div className="text-2xl">{icon}</div>
            <div className="flex-1">
              <p className="text-xs font-bold" style={{ color: 'var(--foreground)' }}>{label}</p>
              <p className="text-[10px]" style={{ color: 'var(--foreground-muted)' }}>{d.orderCount} orders · {d.percentage}%</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-extrabold" style={{ color }}>{fmt(d.revenue)}</p>
              <p className="text-[10px]" style={{ color: 'var(--foreground-muted)' }}>AOV {fmt(d.aov)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Pincode Filter Section ───────────────────────────────────────────────────
function PincodeSection() {
  const [input, setInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [stateFilter, setStateFilter] = useState('')

  const addTag = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) { setTags([...tags, val]); setInput('') }
  }

  const handleSearch = async () => {
    if (tags.length === 0 && !stateFilter) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tags.length) params.set('pincodes', tags.join(','))
      if (stateFilter) params.set('state', stateFilter)
      const res = await fetch(`/api/shopify/pincode-analytics?${params}`)
      const d = await res.json()
      setResults(d)
    } catch { }
    finally { setLoading(false) }
  }

  return (
    <div>
      {/* Input */}
      <div className="flex flex-wrap gap-3 items-end mb-5">
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--foreground-muted)' }}>Pincode(s)</label>
          <div className="flex gap-2">
            <input
              type="text" placeholder="e.g. 110001"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
              className="crm-input px-3 py-2 text-sm rounded-lg w-40"
            />
            <button onClick={addTag} className="px-3 py-2 rounded-lg text-xs font-bold bg-purple-500/10 text-purple-600 border border-purple-500/30 hover:bg-purple-500/20 transition-colors">Add</button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--foreground-muted)' }}>State Filter</label>
          <input type="text" placeholder="e.g. Maharashtra"
            value={stateFilter} onChange={e => setStateFilter(e.target.value)}
            className="crm-input px-3 py-2 text-sm rounded-lg w-44" />
        </div>
        <button onClick={handleSearch} disabled={loading || (tags.length === 0 && !stateFilter)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Analyze
        </button>
      </div>

      {/* Pincode tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map(t => (
            <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold badge-purple">
              <Tag className="w-3 h-3" />{t}
              <button onClick={() => setTags(tags.filter(x => x !== t))}><X className="w-3 h-3" /></button>
            </span>
          ))}
          <button onClick={() => setTags([])} className="text-xs text-red-500 hover:text-red-400 font-semibold">Clear all</button>
        </div>
      )}

      {/* Results summary */}
      {results && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Total Orders', val: results.summary?.totalOrders || 0 },
              { label: 'Total Revenue', val: fmt(results.summary?.totalRevenue || 0) },
              { label: 'Unique Pincodes', val: results.summary?.uniquePincodes || 0 },
            ].map(({ label, val }) => (
              <div key={label} className="crm-card p-4 text-center">
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{label}</p>
                <p className="text-lg font-extrabold mt-1" style={{ color: 'var(--foreground)' }}>{val}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', maxHeight: '300px', overflowY: 'auto' }}>
            <table className="min-w-full text-xs">
              <thead className="sticky top-0" style={{ backgroundColor: 'var(--card-elevated)' }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Pincode','City','State','Zone','Orders','Revenue','COD%','Delivery%','RTO%','Customers','Repeat%'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--foreground-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(results.pincodes || []).map((p: any) => (
                  <tr key={p.pincode} className="transition-colors hover:bg-purple-500/5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2.5 font-bold text-purple-500">{p.pincode}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{p.city}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>{p.state}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>{p.zone || '–'}</td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--foreground)' }}>{p.orderCount}</td>
                    <td className="px-3 py-2.5 font-bold text-emerald-600">{fmt(p.revenue)}</td>
                    <td className="px-3 py-2.5 text-amber-500 font-semibold">{p.codPct}%</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: p.deliveryRate > 60 ? '#059669' : '#D97706' }}>{p.deliveryRate}%</td>
                    <td className="px-3 py-2.5 text-red-500 font-semibold">{p.rtoPct}%</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>{p.customerCount}</td>
                    <td className="px-3 py-2.5 font-semibold text-blue-500">{p.repeatRate}%</td>
                  </tr>
                ))}
                {(results.pincodes || []).length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>No data for selected filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SalesDashboardPage() {
  const [orders, setOrders] = useState<ShopifyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [timeFilter, setTimeFilter] = useState<'all' | '30days' | '7days' | 'today' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [activeTab, setActiveTab] = useState<'orders' | 'remittance'>('orders')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Transactions table filter state
  const [txSearch, setTxSearch] = useState('')
  const [txPaymentFilter, setTxPaymentFilter] = useState('all')
  const [txStatusFilter, setTxStatusFilter] = useState('all')

  const fetchOrders = async (forceRefresh = false) => {
    try {
      setLoading(true)
      if (forceRefresh) {
        setRefreshTrigger(prev => prev + 1)
      }
      const url = forceRefresh ? '/api/shopify/orders?all=true&refresh=true' : '/api/shopify/orders?all=true'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch sales database')

      // Cold start: cache still building — keep polling until orders arrive
      if (data.syncing && (!data.orders || data.orders.length === 0)) {
        setError(null)
        setTimeout(() => fetchOrders(false), 2000)
        return
      }

      setOrders(data.orders || [])
      setIsOffline(!!data.isOffline)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders(false) }, [])

  const processedOrders = useMemo(() => {
    return orders.filter((order) => {
      if (timeFilter === 'all') return true

      const orderDay = toDayKey(order.created_at)
      if (!orderDay) return false

      if (timeFilter === 'custom') {
        if (!customStart && !customEnd) return true
        if (customStart && orderDay < customStart) return false
        if (customEnd && orderDay > customEnd) return false
        return true
      }

      const today = localTodayKey()
      if (timeFilter === 'today') return orderDay === today
      if (timeFilter === '7days') return orderDay >= localDaysAgoKey(6) && orderDay <= today
      if (timeFilter === '30days') return orderDay >= localDaysAgoKey(29) && orderDay <= today
      return true
    })
  }, [orders, timeFilter, customStart, customEnd])

  const metrics = useMemo(() => {
    const activeOrders = processedOrders.filter(o => !isOrderCancelled(o))
    const cancelledCount = processedOrders.filter(isOrderCancelled).length
    let totalRevenue = 0, prepaidCount = 0, codCount = 0, prepaidRevenue = 0, codRevenue = 0
    let codTotalVolume = 0, codSettledCount = 0, codSettledRevenue = 0
    let codPendingCount = 0, codPendingRevenue = 0, codRtoCount = 0, codRtoRevenue = 0
    let unfulfilledCount = 0, scheduledCount = 0, inTransitCount = 0, deliveredCount = 0, rtoCount = 0
    const skuMap: Record<string, { title: string; qty: number; revenue: number }> = {}
    const dailyMap: Record<string, number> = {}

    activeOrders.forEach((o) => {
      const price = parseFloat(o.total_price) || 0
      totalRevenue += price
      const isPaid = !isCodOrder(o)
      const dateKey = new Date(o.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + price

      if (isPaid) { prepaidCount++; prepaidRevenue += price }
      else {
        codCount++; codRevenue += price; codTotalVolume += price
        const status = getShipStatus(o)
        if (status === 'delivered') { codSettledCount++; codSettledRevenue += price }
        else if (['failure','rto','returned'].includes(status)) { codRtoCount++; codRtoRevenue += price }
        else { codPendingCount++; codPendingRevenue += price }
      }

      if (!o.fulfillment_status) { unfulfilledCount++ }
      else {
        const status = getShipStatus(o)
        if (status === 'delivered') deliveredCount++
        else if (['failure','rto','returned'].includes(status)) rtoCount++
        else if (['in_transit','out_for_delivery','attempted_delivery'].includes(status)) inTransitCount++
        else scheduledCount++
      }

      o.line_items?.forEach((item) => {
        const sku = item.sku || 'N/A'; const qty = Number(item.quantity) || 1
        const itemVal = (parseFloat(item.price) || 0) * qty
        if (!skuMap[sku]) skuMap[sku] = { title: item.title || 'Product', qty: 0, revenue: 0 }
        skuMap[sku].qty += qty; skuMap[sku].revenue += itemVal
      })
    })

    const topProducts = Object.entries(skuMap)
      .map(([sku, d]) => ({ sku, ...d })).sort((a, b) => b.qty - a.qty).slice(0, 5)

    const totalOrdersCount = activeOrders.length
    const aov = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0
    const deliveryRate = totalOrdersCount > 0 ? (deliveredCount / totalOrdersCount) * 100 : 0
    const dispatchRate = totalOrdersCount > 0 ? ((totalOrdersCount - unfulfilledCount) / totalOrdersCount) * 100 : 0

    const dailyRevenue = Object.entries(dailyMap)
      .map(([date, revenue]) => ({ date, revenue }))
      .slice(-14)

    return {
      totalRevenue, totalOrders: totalOrdersCount, cancelledCount, aov,
      prepaidCount, prepaidRevenue, codCount, codRevenue,
      unfulfilledCount, scheduledCount, inTransitCount, deliveredCount, rtoCount,
      topProducts, codTotalVolume, codSettledCount, codSettledRevenue,
      codPendingCount, codPendingRevenue, codRtoCount, codRtoRevenue,
      deliveryRate, dispatchRate, dailyRevenue,
    }
  }, [processedOrders])

  const filteredTxOrders = useMemo(() => {
    return processedOrders.filter((o) => {
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase()
        const name = (o.name || '').toLowerCase()
        const cust = o.customer ? `${o.customer.first_name||''} ${o.customer.last_name||''}`.toLowerCase() : ''
        if (!name.includes(q) && !cust.includes(q)) return false
      }
      if (txPaymentFilter !== 'all') {
        const isPaid = !isCodOrder(o)
        if (txPaymentFilter === 'prepaid' && !isPaid) return false
        if (txPaymentFilter === 'cod' && isPaid) return false
      }
      if (txStatusFilter !== 'all') {
        const isCancelled = isOrderCancelled(o)
        if (isCancelled) return txStatusFilter === 'cancelled'
        if (!o.fulfillment_status) return txStatusFilter === 'unfulfilled'
        const status = getShipStatus(o)
        if (status === 'delivered') return txStatusFilter === 'delivered'
        if (['failure','rto','returned'].includes(status)) return txStatusFilter === 'rto'
        if (['in_transit','out_for_delivery','attempted_delivery'].includes(status)) return txStatusFilter === 'transit'
        return txStatusFilter === 'scheduled'
      } else {
        if (isOrderCancelled(o)) return false
      }
      return true
    })
  }, [processedOrders, txSearch, txPaymentFilter, txStatusFilter])

  const codOrders = useMemo(() => processedOrders.filter(o => !isOrderCancelled(o) && isCodOrder(o)), [processedOrders])

  const TABS = [
    { id: 'orders', label: '📦 Prepaid & COD Orders', desc: 'Order analytics, payment split, delivery funnel' },
    { id: 'remittance', label: '💰 COD Remittance & Settlements', desc: 'Cash flow, settlements, financial reports' },
  ]

  const tabColors = {
    unfulfilled: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    scheduled: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    transit: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    delivered: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    rto: 'bg-red-500/10 text-red-500 border-red-500/20',
    cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto mt-20">

          {/* ── Page Header ── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold badge-purple">Live Analytics Engine</span>
                {loading && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    <Loader2 className="w-3 h-3 animate-spin" /> Syncing...
                  </span>
                )}
              </div>
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--foreground)' }}>
                Real-Time Sales Dashboard
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                Live Shopify data · {metrics.totalOrders} active orders
              </p>
            </div>
            <div className="flex flex-col items-stretch md:items-end gap-2">
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl p-1 border" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
                  {(['all', '30days', '7days', 'today', 'custom'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setTimeFilter(f)
                        // Seed a recent range so Custom never lands on an empty selection
                        if (f === 'custom' && !customStart && !customEnd) {
                          setCustomStart(localDaysAgoKey(6))
                          setCustomEnd(localTodayKey())
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all flex items-center gap-1 ${
                        timeFilter === f ? 'bg-purple-600 text-white shadow-md' : 'hover:bg-purple-500/10'
                      }`}
                      style={timeFilter !== f ? { color: 'var(--foreground-muted)' } : {}}>
                      {f === '30days' ? 'Last 30D' : f === '7days' ? 'Last 7D' : f === 'custom' ? (
                        <><Calendar className="w-3 h-3" /> Custom</>
                      ) : f}
                    </button>
                  ))}
                </div>
                <button onClick={() => fetchOrders(true)} disabled={loading}
                  className="p-2.5 rounded-xl border transition-all hover:border-purple-500/40 active:scale-95"
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                  title="Refresh Data">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {timeFilter === 'custom' && (
                <div className="flex items-center gap-2 rounded-xl p-1.5 border"
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--foreground-muted)' }}>From</label>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || undefined}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="px-2 py-1 rounded-lg text-xs border focus:outline-none focus:border-purple-500/50"
                      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider px-1" style={{ color: 'var(--foreground-muted)' }}>To</label>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      max={localTodayKey()}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="px-2 py-1 rounded-lg text-xs border focus:outline-none focus:border-purple-500/50"
                      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    />
                  </div>
                  {(customStart || customEnd) && (
                    <button
                      onClick={() => { setCustomStart(''); setCustomEnd('') }}
                      className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors mt-3"
                      style={{ color: 'var(--foreground-muted)' }}
                      title="Clear dates"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Alerts ── */}
          {isOffline && (
            <div className="mb-5 p-4 rounded-xl border border-amber-500/30 bg-amber-500/8 text-amber-600 text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span><strong>Offline / Demo Mode:</strong> Showing cached data. Live Shopify endpoint unreachable.</span>
            </div>
          )}
          {error && !isOffline && (
            <div className="mb-5 p-4 rounded-xl border border-red-500/30 bg-red-500/8 text-red-600 text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />{error}
            </div>
          )}

          {/* ── Analytics Tabs ── */}
          <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-sm font-semibold transition-all relative whitespace-nowrap ${
                  activeTab === tab.id ? 'analytics-tab-active' : 'hover:bg-purple-500/5'
                }`}
                style={activeTab !== tab.id ? { color: 'var(--foreground-muted)' } : { color: 'var(--foreground)' }}>
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t" />
                )}
              </button>
            ))}
          </div>

          {loading && orders.length === 0 ? (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">{[...Array(8)].map((_,i) => <SkeletonCard key={i} />)}</div>
            </div>
          ) : (

            /* ══════════════════════════════════════════════════════════════
               TAB 1 — PREPAID & COD ORDERS
            ══════════════════════════════════════════════════════════════ */
            activeTab === 'orders' ? (
              <div className="space-y-8">

                {/* SECTION 1 — Orders Overview */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-purple-600 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>
                      Orders Overview
                    </h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Total Orders" value={metrics.totalOrders} icon={ShoppingBag} color="bg-purple-500/10 text-purple-500" sub={`+ ${metrics.cancelledCount} cancelled`} />
                    <StatCard label="Delivered" value={metrics.deliveredCount} icon={CheckCircle} color="bg-emerald-500/10 text-emerald-500" trend={{ dir: 'up', text: `${metrics.deliveryRate.toFixed(1)}% success rate` }} />
                    <StatCard label="In Transit" value={metrics.inTransitCount} icon={Truck} color="bg-amber-500/10 text-amber-500" sub="Active shipments" />
                    <StatCard label="Unfulfilled" value={metrics.unfulfilledCount} icon={Clock} color="bg-blue-500/10 text-blue-500" sub="Awaiting pickup" />
                    <StatCard label="RTO / Returns" value={metrics.rtoCount} icon={XCircle} color="bg-red-500/10 text-red-500" trend={{ dir: 'down', text: `${metrics.totalOrders > 0 ? ((metrics.rtoCount/metrics.totalOrders)*100).toFixed(1) : 0}% RTO rate` }} />
                    <StatCard label="Cancelled" value={metrics.cancelledCount} icon={X} color="bg-gray-500/10 text-gray-400" sub="Voided / Refunded" />
                    <StatCard label="Dispatch Rate" value={`${metrics.dispatchRate.toFixed(1)}%`} icon={Package} color="bg-cyan-500/10 text-cyan-500" sub="Orders dispatched" />
                    <StatCard label="Delivery Success" value={`${metrics.deliveryRate.toFixed(1)}%`} icon={TrendingUp} color="bg-green-500/10 text-green-500" sub="Of dispatched orders" />
                  </div>
                </section>

                {/* SECTION 2 — Order Analytics */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-blue-600 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>
                      Order Analytics
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                    {/* Payment Distribution */}
                    <div className="crm-card p-6">
                      <div className="flex items-center gap-2 mb-1">
                        <CreditCard className="w-4 h-4 text-purple-500" />
                        <h3 className="font-extrabold text-sm" style={{ color: 'var(--foreground)' }}>Payment Distribution</h3>
                      </div>
                      <p className="text-xs mb-5" style={{ color: 'var(--foreground-muted)' }}>Prepaid vs COD allocation across all orders.</p>
                      <div className="space-y-5">
                        {[
                          { label: `Prepaid (${metrics.prepaidCount})`, pct: metrics.totalOrders > 0 ? (metrics.prepaidCount/metrics.totalOrders)*100 : 0, revenue: metrics.prepaidRevenue, color: '#059669', barColor: 'bg-emerald-500', textColor: 'text-emerald-600' },
                          { label: `COD (${metrics.codCount})`, pct: metrics.totalOrders > 0 ? (metrics.codCount/metrics.totalOrders)*100 : 0, revenue: metrics.codRevenue, color: '#D97706', barColor: 'bg-amber-500', textColor: 'text-amber-600' },
                        ].map(({ label, pct, revenue, barColor, textColor }) => (
                          <div key={label}>
                            <div className="flex justify-between text-xs font-semibold mb-1.5">
                              <span className={textColor}>{label}</span>
                              <span style={{ color: 'var(--foreground)' }}>{pct.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                              <div className={`${barColor} h-full rounded-full progress-bar`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[10px] mt-1" style={{ color: 'var(--foreground-muted)' }}>Volume: {fmt(revenue)}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 pt-3 border-t text-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}>
                        COD Ratio: {metrics.totalOrders > 0 ? ((metrics.codCount/metrics.totalOrders)*100).toFixed(1) : 0}% ·
                        Prepaid Ratio: {metrics.totalOrders > 0 ? ((metrics.prepaidCount/metrics.totalOrders)*100).toFixed(1) : 0}%
                      </div>
                    </div>

                    {/* Delivery Funnel */}
                    <div className="crm-card p-6">
                      <div className="flex items-center gap-2 mb-1">
                        <Truck className="w-4 h-4 text-blue-500" />
                        <h3 className="font-extrabold text-sm" style={{ color: 'var(--foreground)' }}>Delivery Funnel</h3>
                      </div>
                      <p className="text-xs mb-5" style={{ color: 'var(--foreground-muted)' }}>Real-time Shiprocket shipment status breakdown.</p>
                      <div className="space-y-3">
                        {[
                          { label: 'Unfulfilled', count: metrics.unfulfilledCount, color: '#3B82F6', bg: 'bg-blue-500' },
                          { label: 'Pickup Scheduled', count: metrics.scheduledCount, color: '#F59E0B', bg: 'bg-amber-500/70' },
                          { label: 'In Transit', count: metrics.inTransitCount, color: '#EAB308', bg: 'bg-yellow-500' },
                          { label: 'Delivered', count: metrics.deliveredCount, color: '#22C55E', bg: 'bg-green-500' },
                          { label: 'RTO / Returned', count: metrics.rtoCount, color: '#EF4444', bg: 'bg-red-500' },
                        ].map(({ label, count, color, bg }) => {
                          const pct = metrics.totalOrders > 0 ? (count/metrics.totalOrders)*100 : 0
                          return (
                            <div key={label} className="flex items-center gap-3 text-xs">
                              <span className="w-28 truncate font-medium" style={{ color }}>{label}</span>
                              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                                <div className={`${bg} h-full rounded-full progress-bar`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="w-6 text-right font-bold" style={{ color: 'var(--foreground)' }}>{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Top Selling SKUs */}
                    <div className="crm-card p-6">
                      <div className="flex items-center gap-2 mb-1">
                        <Award className="w-4 h-4 text-amber-500" />
                        <h3 className="font-extrabold text-sm" style={{ color: 'var(--foreground)' }}>Top Performing SKUs</h3>
                      </div>
                      <p className="text-xs mb-5" style={{ color: 'var(--foreground-muted)' }}>Best-selling products by units sold.</p>
                      <div className="space-y-3.5">
                        {metrics.topProducts.length === 0 ? (
                          <p className="text-xs text-center py-8" style={{ color: 'var(--foreground-muted)' }}>No product data in selected range.</p>
                        ) : metrics.topProducts.map((p, i) => (
                          <div key={p.sku} className="flex items-center gap-3 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-extrabold badge-purple shrink-0">{i+1}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate" style={{ color: 'var(--foreground)' }} title={p.title}>{p.title}</p>
                              <p className="text-[10px]" style={{ color: 'var(--foreground-muted)' }}>SKU: {p.sku}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-bold" style={{ color: 'var(--foreground)' }}>{p.qty} units</p>
                              <p className="text-[10px] text-emerald-600 font-semibold">{fmt(p.revenue)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* SECTION 3 — Revenue Analytics */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-emerald-600 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Revenue Analytics</h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <StatCard label="Total Revenue" value={fmt(metrics.totalRevenue)} icon={DollarSign} color="bg-purple-500/10 text-purple-500" trend={{ dir: 'up', text: 'Live Shopify Sync' }} />
                    <StatCard label="Average Order Value" value={fmt(metrics.aov)} icon={TrendingUp} color="bg-emerald-500/10 text-emerald-500" sub="Per active order" />
                    <StatCard label="Prepaid Revenue" value={fmt(metrics.prepaidRevenue)} icon={CreditCard} color="bg-blue-500/10 text-blue-500" sub={`${metrics.prepaidCount} prepaid orders`} />
                    <StatCard label="COD Revenue" value={fmt(metrics.codRevenue)} icon={Coins} color="bg-amber-500/10 text-amber-500" sub={`${metrics.codCount} COD orders`} />
                  </div>

                  {/* Daily Revenue Trend Chart */}
                  {metrics.dailyRevenue.length > 1 && (
                    <div className="crm-card p-5">
                      <h3 className="font-bold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
                        <BarChart2 className="w-4 h-4 text-purple-500" />
                        Daily Revenue Trend (Last 14 Days)
                      </h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={metrics.dailyRevenue}>
                          <defs>
                            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: any) => [fmt(v), 'Revenue']} contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)', fontSize: 11 }} />
                          <Area type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2} fill="url(#revGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </section>

                {/* SECTION 4 — COD Analytics */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-amber-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>COD Analytics</h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Total COD Volume" value={fmt(metrics.codTotalVolume)} icon={Coins} color="bg-amber-500/10 text-amber-500" sub={`${metrics.codCount} COD orders`} />
                    <StatCard label="COD Ratio" value={`${metrics.totalOrders > 0 ? ((metrics.codCount/metrics.totalOrders)*100).toFixed(1) : 0}%`} icon={BarChart2} color="bg-orange-500/10 text-orange-500" sub="of all orders" />
                    <StatCard label="COD Settled" value={fmt(metrics.codSettledRevenue)} icon={CheckCircle} color="bg-emerald-500/10 text-emerald-500" sub={`${metrics.codSettledCount} delivered`} />
                    <StatCard label="COD Unrealized (RTO)" value={fmt(metrics.codRtoRevenue)} icon={XCircle} color="bg-red-500/10 text-red-500" sub={`${metrics.codRtoCount} RTO orders`} />
                  </div>
                </section>

                {/* SECTION 5 — Gender Analytics */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-pink-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Gender Sales Analytics</h2>
                  </div>
                  <GenderAnalyticsSection orders={orders} refreshTrigger={refreshTrigger} />
                </section>

                {/* SECTION 6 — Zone-wise Sales */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-cyan-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Zone-wise Sales Intelligence</h2>
                  </div>
                  <ZoneAnalyticsSection />
                </section>

                {/* SECTION 7 — Pincode Intelligence */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-teal-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Pincode Intelligence</h2>
                  </div>
                  <div className="crm-card p-6">
                    <PincodeSection />
                  </div>
                </section>

                {/* SECTION 8 — Live Transactions Log */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-indigo-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Live Transactions Log</h2>
                  </div>
                  <div className="crm-card p-6">
                    {/* Filters */}
                    <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[10px] font-bold uppercase flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />Live Feed
                        </span>
                        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{filteredTxOrders.length} transactions</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="relative">
                          <input type="text" placeholder="Search order/customer..." value={txSearch} onChange={e => setTxSearch(e.target.value)}
                            className="pl-8 pr-3 py-1.5 text-xs rounded-lg w-48 crm-input" />
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--foreground-muted)' }} />
                        </div>
                        <select value={txPaymentFilter} onChange={e => setTxPaymentFilter(e.target.value)} className="px-2.5 py-1.5 text-xs rounded-lg crm-input cursor-pointer">
                          <option value="all">All Payments</option>
                          <option value="prepaid">Prepaid</option>
                          <option value="cod">COD</option>
                        </select>
                        <select value={txStatusFilter} onChange={e => setTxStatusFilter(e.target.value)} className="px-2.5 py-1.5 text-xs rounded-lg crm-input cursor-pointer">
                          <option value="all">All Status</option>
                          <option value="unfulfilled">Unfulfilled</option>
                          <option value="scheduled">Pickup Scheduled</option>
                          <option value="transit">In Transit</option>
                          <option value="delivered">Delivered</option>
                          <option value="rto">RTO</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', maxHeight: '380px', overflowY: 'auto' }}>
                      <table className="min-w-full text-xs text-left">
                        <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--card-elevated)' }}>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Order','Customer','Date','Payment','Status','Value'].map(h => (
                              <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTxOrders.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>No transactions match the selected filters.</td></tr>
                          ) : filteredTxOrders.map((o) => {
                            const isCancelled = isOrderCancelled(o)
                            const cust = o.customer ? `${o.customer.first_name||''} ${o.customer.last_name||''}`.trim() : 'Guest Checkout'
                            let dispStatus = 'Unfulfilled', statusClass = 'badge-info'
                            if (isCancelled) { dispStatus = 'Cancelled'; statusClass = 'bg-gray-500/10 text-gray-500 border-gray-500/20' }
                            else if (o.fulfillment_status) {
                              const s = getShipStatus(o)
                              if (s === 'delivered') { dispStatus = 'Delivered'; statusClass = 'badge-success' }
                              else if (['failure','rto','returned'].includes(s)) { dispStatus = 'RTO'; statusClass = 'badge-danger' }
                              else if (['in_transit','out_for_delivery'].includes(s)) { dispStatus = 'In Transit'; statusClass = 'badge-warning' }
                              else { dispStatus = 'Pickup Scheduled'; statusClass = 'badge-warning' }
                            }
                            return (
                              <tr key={o.id} className="transition-colors hover:bg-purple-500/5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td className="px-4 py-3 font-bold text-purple-500">{o.name}</td>
                                <td className="px-4 py-3 font-medium" style={{ color: 'var(--foreground)' }}>{cust}</td>
                                <td className="px-4 py-3" style={{ color: 'var(--foreground-muted)' }}>
                                  {new Date(o.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isCodOrder(o) ? 'badge-warning' : 'badge-success'}`}>
                                    {getPaymentLabel(o)}
                                  </span>
                                </td>
                                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusClass}`}>{dispStatus}</span></td>
                                <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--foreground)' }}>₹{parseFloat(o.total_price||'0').toLocaleString('en-IN')}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>

            ) : (

            /* ══════════════════════════════════════════════════════════════
               TAB 2 — COD REMITTANCE & SETTLEMENTS
            ══════════════════════════════════════════════════════════════ */
              <div className="space-y-8">

                {/* Summary Cards */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-amber-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>COD Remittance Overview</h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <StatCard label="Total COD Collection" value={fmt(metrics.codTotalVolume)} icon={Coins} color="bg-amber-500/10 text-amber-500" sub={`${metrics.codCount} orders`} />
                    <StatCard label="Settled & Received" value={fmt(metrics.codSettledRevenue)} icon={CheckCircle} color="bg-emerald-500/10 text-emerald-500" trend={{ dir: 'up', text: `${metrics.codTotalVolume > 0 ? ((metrics.codSettledRevenue/metrics.codTotalVolume)*100).toFixed(1) : 0}% settled` }} />
                    <StatCard label="Pending Collection" value={fmt(metrics.codPendingRevenue)} icon={Clock} color="bg-yellow-500/10 text-yellow-500" sub={`${metrics.codPendingCount} in transit`} />
                    <StatCard label="RTO Unrealized" value={fmt(metrics.codRtoRevenue)} icon={XCircle} color="bg-red-500/10 text-red-500" trend={{ dir: 'down', text: `${metrics.codRtoCount} RTO orders` }} />
                  </div>

                  {/* Remittance Progress Bar */}
                  <div className="crm-card p-5 mb-5">
                    <p className="text-xs font-bold mb-3" style={{ color: 'var(--foreground-muted)' }}>Remittance Allocation Breakdown</p>
                    <div className="w-full h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--border)' }}>
                      <div className="bg-emerald-500 h-full transition-all duration-1000" title="Settled"
                        style={{ width: `${metrics.codTotalVolume > 0 ? (metrics.codSettledRevenue/metrics.codTotalVolume)*100 : 0}%` }} />
                      <div className="bg-amber-400 h-full transition-all duration-1000" title="Pending"
                        style={{ width: `${metrics.codTotalVolume > 0 ? (metrics.codPendingRevenue/metrics.codTotalVolume)*100 : 0}%` }} />
                      <div className="bg-red-500 h-full transition-all duration-1000" title="RTO"
                        style={{ width: `${metrics.codTotalVolume > 0 ? (metrics.codRtoRevenue/metrics.codTotalVolume)*100 : 0}%` }} />
                    </div>
                    <div className="flex gap-4 mt-2 text-[10px]">
                      {[
                        { label: 'Settled', color: 'bg-emerald-500', val: `${metrics.codTotalVolume > 0 ? ((metrics.codSettledRevenue/metrics.codTotalVolume)*100).toFixed(1) : 0}%` },
                        { label: 'Pending', color: 'bg-amber-400', val: `${metrics.codTotalVolume > 0 ? ((metrics.codPendingRevenue/metrics.codTotalVolume)*100).toFixed(1) : 0}%` },
                        { label: 'RTO Unrealized', color: 'bg-red-500', val: `${metrics.codTotalVolume > 0 ? ((metrics.codRtoRevenue/metrics.codTotalVolume)*100).toFixed(1) : 0}%` },
                      ].map(({ label, color, val }) => (
                        <div key={label} className="flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                          <div className={`w-2 h-2 rounded-full ${color}`} />{label}: <span className="font-bold" style={{ color: 'var(--foreground)' }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Net / Gross / Estimated Charges */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="crm-card p-5">
                      <p className="text-xs font-bold mb-3" style={{ color: 'var(--foreground-muted)' }}>📊 Gross Sales</p>
                      <p className="text-2xl font-extrabold text-purple-600">{fmt(metrics.totalRevenue)}</p>
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--foreground-muted)' }}>All orders (active + cancelled)</p>
                    </div>
                    <div className="crm-card p-5">
                      <p className="text-xs font-bold mb-3" style={{ color: 'var(--foreground-muted)' }}>💰 Net Sales (Active Only)</p>
                      <p className="text-2xl font-extrabold text-emerald-600">{fmt(metrics.totalRevenue)}</p>
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--foreground-muted)' }}>Excludes {metrics.cancelledCount} cancelled orders</p>
                    </div>
                    <div className="crm-card p-5">
                      <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                        <span>🚚 Est. Logistics Charges</span>
                      </p>
                      <p className="text-2xl font-extrabold text-orange-500">
                        {fmt((metrics.deliveredCount + metrics.inTransitCount + metrics.scheduledCount) * 65)}
                      </p>
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--foreground-muted)' }}>~₹65 per shipment (Shiprocket estimate)</p>
                    </div>
                  </div>
                </section>

                {/* COD Remittance Ledger */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-yellow-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>COD Remittance Ledger</h2>
                  </div>
                  <div className="crm-card p-6">
                    <CODTable orders={codOrders} />
                  </div>
                </section>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  )
}
