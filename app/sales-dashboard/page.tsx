'use client'

import { apiFetch } from '@/lib/auth'
import { useEffect, useState, useMemo } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import {
  TrendingUp, ShoppingBag, DollarSign, CreditCard, Truck, RefreshCw,
  Loader2, AlertCircle, Award, ChevronRight, Sparkles, TrendingDown,
  Coins, FileSpreadsheet, Search, MapPin, Users, BarChart2, X,
  Download, CheckCircle, XCircle, Clock, Package, ArrowUpRight,
  ArrowDownRight, Globe, Filter, Tag, Calendar
} from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line, Area, AreaChart } from 'recharts'

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface SalesAnalytics {
  overview: {
    totalOrders: number; cancelledCount: number; deliveredCount: number
    inTransitCount: number; unfulfilledCount: number; scheduledCount: number
    rtoCount: number; deliveryRate: number; dispatchRate: number; rtoRate: number
  }
  payment: {
    prepaidCount: number; prepaidRevenue: number; codCount: number; codRevenue: number
    prepaidPct: number; codPct: number
  }
  deliveryFunnel: {
    unfulfilled: number; scheduled: number; inTransit: number; delivered: number; rto: number
  }
  revenue: {
    totalRevenue: number; aov: number; prepaidRevenue: number; codRevenue: number
    dailyRevenue: Array<{ date: string; revenue: number }>
  }
  cod: {
    totalVolume: number; settledCount: number; settledRevenue: number
    pendingCount: number; pendingRevenue: number; rtoCount: number; rtoRevenue: number; ratio: number
  }
  codRemittance: {
    settledPct: number; pendingPct: number; rtoPct: number
    grossSales: number; netSales: number; estimatedLogisticsCharges: number
  }
  topProducts: Array<{ sku: string; title: string; qty: number; revenue: number }>
  zones: any[]
  gender: { summary: any; topProductsByGender: any[]; totalOrders: number } | null
  pincodes: any[]
  pincodeSummary: { totalOrders: number; totalRevenue: number; uniquePincodes: number }
  transactions: Array<{
    id: number; name: string; customer: string; createdAt: string
    payment: string; paymentType: string; status: string; value: number; currency: string
  }>
  codLedger: Array<{
    id: number; name: string; customer: string; city: string; state: string; pincode: string
    amount: number; logisticsStatus: string; remittanceStatus: string
    dispatchDate: string | null; deliveryDate: string | null
  }>
  isOffline?: boolean
  syncing?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtNum = (n: number) => new Intl.NumberFormat('en-IN').format(n)

function localTodayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDaysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildAnalyticsUrl(
  timeFilter: 'all' | '30days' | '7days' | 'today' | 'custom',
  customStart: string,
  customEnd: string,
  refresh = false,
): string {
  const params = new URLSearchParams()
  if (refresh) params.set('refresh', 'true')
  const today = localTodayKey()
  if (timeFilter === 'today') {
    params.set('start_date', today)
    params.set('end_date', today)
  } else if (timeFilter === '7days') {
    params.set('start_date', localDaysAgoKey(6))
    params.set('end_date', today)
  } else if (timeFilter === '30days') {
    params.set('start_date', localDaysAgoKey(29))
    params.set('end_date', today)
  } else if (timeFilter === 'custom') {
    if (customStart) params.set('start_date', customStart)
    if (customEnd) params.set('end_date', customEnd)
  }
  const qs = params.toString()
  return `/api/shopify/product-sales${qs ? `?${qs}` : ''}`
}

function analyticsToMetrics(data: SalesAnalytics | null) {
  if (!data) {
    return {
      totalOrders: 0, cancelledCount: 0, deliveredCount: 0, inTransitCount: 0,
      unfulfilledCount: 0, scheduledCount: 0, rtoCount: 0, deliveryRate: 0, dispatchRate: 0,
      prepaidCount: 0, prepaidRevenue: 0, codCount: 0, codRevenue: 0,
      totalRevenue: 0, aov: 0, dailyRevenue: [],
      topProducts: [] as SalesAnalytics['topProducts'],
      codTotalVolume: 0, codSettledCount: 0, codSettledRevenue: 0,
      codPendingCount: 0, codPendingRevenue: 0, codRtoCount: 0, codRtoRevenue: 0,
    }
  }
  return {
    totalOrders: data.overview.totalOrders,
    cancelledCount: data.overview.cancelledCount,
    deliveredCount: data.overview.deliveredCount,
    inTransitCount: data.overview.inTransitCount,
    unfulfilledCount: data.overview.unfulfilledCount,
    scheduledCount: data.overview.scheduledCount,
    rtoCount: data.overview.rtoCount,
    deliveryRate: data.overview.deliveryRate,
    dispatchRate: data.overview.dispatchRate,
    prepaidCount: data.payment.prepaidCount,
    prepaidRevenue: data.payment.prepaidRevenue,
    codCount: data.payment.codCount,
    codRevenue: data.payment.codRevenue,
    totalRevenue: data.revenue.totalRevenue,
    aov: data.revenue.aov,
    dailyRevenue: data.revenue.dailyRevenue,
    topProducts: data.topProducts,
    codTotalVolume: data.cod.totalVolume,
    codSettledCount: data.cod.settledCount,
    codSettledRevenue: data.cod.settledRevenue,
    codPendingCount: data.cod.pendingCount,
    codPendingRevenue: data.cod.pendingRevenue,
    codRtoCount: data.cod.rtoCount,
    codRtoRevenue: data.cod.rtoRevenue,
  }
}

const TX_STATUS_LABELS: Record<string, string> = {
  cancelled: 'Cancelled',
  unfulfilled: 'Unfulfilled',
  scheduled: 'Pickup Scheduled',
  transit: 'In Transit',
  delivered: 'Delivered',
  rto: 'RTO',
}

const TX_STATUS_CLASSES: Record<string, string> = {
  cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  unfulfilled: 'badge-info',
  scheduled: 'badge-warning',
  transit: 'badge-warning',
  delivered: 'badge-success',
  rto: 'badge-danger',
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
function CODTable({ ledger }: { ledger: SalesAnalytics['codLedger'] }) {
  const [search, setSearch] = useState('')
  const [remittanceFilter, setRemittanceFilter] = useState('all')
  const [logisticsFilter, setLogisticsFilter] = useState('all')

  const filtered = useMemo(() => {
    return ledger.filter((row) => {
      if (search.trim()) {
        const q = search.toLowerCase()
        if (!row.name.toLowerCase().includes(q) && !row.customer.toLowerCase().includes(q)) return false
      }
      if (remittanceFilter !== 'all' && row.remittanceStatus !== remittanceFilter) return false
      if (logisticsFilter !== 'all') {
        const status = row.logisticsStatus
        if (logisticsFilter === 'unfulfilled' && status !== 'unfulfilled') return false
        if (logisticsFilter === 'delivered' && status !== 'delivered') return false
        if (logisticsFilter === 'rto' && !['failure', 'rto', 'returned'].includes(status)) return false
        if (logisticsFilter === 'transit' && !['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status)) return false
        if (logisticsFilter === 'scheduled' && ['delivered', 'failure', 'rto', 'returned', 'in_transit', 'out_for_delivery', 'attempted_delivery', 'unfulfilled'].includes(status)) return false
      }
      return true
    })
  }, [ledger, search, remittanceFilter, logisticsFilter])

  const exportCSV = () => {
    const header = 'Order,Customer,City,State,Pincode,Amount,Logistics,Remittance,Dispatch Date,Delivery Date'
    const rows = filtered.map((row) => {
      const remit = row.remittanceStatus === 'settled' ? 'Settled' : row.remittanceStatus === 'rto' ? 'RTO Unrealized' : 'Pending'
      return `${row.name},"${row.customer}","${row.city}","${row.state}","${row.pincode}",${row.amount},${row.logisticsStatus},${remit},"${row.dispatchDate || ''}","${row.deliveryDate || ''}"`
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'cod_remittance.csv'; a.click()
  }

  const logLabel = (status: string) => {
    if (status === 'delivered') return { label: 'Delivered', class: 'badge-success' }
    if (['failure', 'rto', 'returned'].includes(status)) return { label: 'RTO', class: 'badge-danger' }
    if (status === 'unfulfilled') return { label: 'Unfulfilled', class: 'badge-info' }
    if (['in_transit', 'out_for_delivery', 'attempted_delivery'].includes(status)) return { label: 'In Transit', class: 'badge-warning' }
    return { label: status ? status.replace('_', ' ') : 'Pickup Scheduled', class: 'badge-warning' }
  }

  const remLabel = (status: string) => {
    if (status === 'settled') return { label: 'Settled', class: 'badge-success' }
    if (status === 'rto') return { label: 'RTO Unrealized', class: 'badge-danger' }
    return { label: 'Pending', class: 'badge-warning' }
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
            ) : filtered.map((row) => {
              const log = logLabel(row.logisticsStatus)
              const rem = remLabel(row.remittanceStatus)
              return (
                <tr key={row.id} className="transition-colors hover:bg-purple-500/5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="px-4 py-3 font-bold text-purple-500">{row.name}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--foreground)' }}>{row.customer}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--foreground-muted)' }}>
                    <div className="text-xs">{row.city || '–'}</div>
                    <div className="text-[10px] opacity-60">{row.state || ''}{row.pincode ? ` · ${row.pincode}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--foreground)' }}>₹{row.amount.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${log.class}`}>{log.label}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rem.class}`}>{rem.label}</span></td>
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
function ZoneAnalyticsSection({ zones }: { zones: any[] }) {
  const [activeZone, setActiveZone] = useState<string | null>(null)

  const maxOrders = Math.max(...zones.map(z => z.orderCount), 1)

  const ZONE_ICONS: Record<string, string> = {
    'North': '🏔️', 'South': '🌴', 'East': '🌊', 'West': '🏜️', 'Central': '🌾', 'North-East': '🍃'
  }

  if (zones.length === 0) {
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
function GenderAnalyticsSection({ gender }: { gender: SalesAnalytics['gender'] }) {
  if (!gender?.summary) return null

  const { male, female } = gender.summary
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
function PincodeSection({ defaultPincodes, defaultSummary }: {
  defaultPincodes?: SalesAnalytics['pincodes']
  defaultSummary?: SalesAnalytics['pincodeSummary']
}) {
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
      const res = await apiFetch(`/api/shopify/pincode-analytics?${params}`)
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

      {/* Default top pincodes from analytics API */}
      {defaultPincodes && defaultPincodes.length > 0 && !results && (
        <div className="mb-6">
          <p className="text-xs font-bold mb-3" style={{ color: 'var(--foreground-muted)' }}>Top Pincodes (current range)</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Total Orders', val: defaultSummary?.totalOrders || 0 },
              { label: 'Total Revenue', val: fmt(defaultSummary?.totalRevenue || 0) },
              { label: 'Unique Pincodes', val: defaultSummary?.uniquePincodes || 0 },
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
                  {['Pincode','City','State','Zone','Orders','Revenue','COD%','Delivery%','RTO%'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--foreground-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defaultPincodes.slice(0, 20).map((p: any) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
  const [analytics, setAnalytics] = useState<SalesAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [timeFilter, setTimeFilter] = useState<'all' | '30days' | '7days' | 'today' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [activeTab, setActiveTab] = useState<'orders' | 'remittance'>('orders')

  // Transactions table filter state
  const [txSearch, setTxSearch] = useState('')
  const [txPaymentFilter, setTxPaymentFilter] = useState('all')
  const [txStatusFilter, setTxStatusFilter] = useState('all')

  const fetchAnalytics = async (forceRefresh = false) => {
    try {
      setLoading(true)
      const url = buildAnalyticsUrl(timeFilter, customStart, customEnd, forceRefresh)
      const res = await apiFetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch sales analytics')

      if (data.syncing && !data.overview) {
        setError(null)
        setTimeout(() => fetchAnalytics(false), 2000)
        return
      }

      setAnalytics(data as SalesAnalytics)
      setIsOffline(!!data.isOffline)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAnalytics(false) }, [timeFilter, customStart, customEnd])

  const metrics = useMemo(() => analyticsToMetrics(analytics), [analytics])

  const filteredTransactions = useMemo(() => {
    const rows = analytics?.transactions || []
    return rows.filter((tx) => {
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase()
        if (!tx.name.toLowerCase().includes(q) && !tx.customer.toLowerCase().includes(q)) return false
      }
      if (txPaymentFilter !== 'all' && tx.paymentType !== txPaymentFilter) return false
      if (txStatusFilter !== 'all') {
        if (tx.status !== txStatusFilter) return false
      } else if (tx.status === 'cancelled') {
        return false
      }
      return true
    })
  }, [analytics, txSearch, txPaymentFilter, txStatusFilter])

  const codRemittance = analytics?.codRemittance

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
                <button onClick={() => fetchAnalytics(true)} disabled={loading}
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

          {loading && !analytics ? (
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
                  <GenderAnalyticsSection gender={analytics?.gender ?? null} />
                </section>

                {/* SECTION 6 — Zone-wise Sales */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-cyan-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Zone-wise Sales Intelligence</h2>
                  </div>
                  <ZoneAnalyticsSection zones={analytics?.zones || []} />
                </section>

                {/* SECTION 7 — Pincode Intelligence */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-5 bg-teal-500 rounded-full" />
                    <h2 className="text-base font-extrabold uppercase tracking-wide" style={{ color: 'var(--foreground)' }}>Pincode Intelligence</h2>
                  </div>
                  <div className="crm-card p-6">
                    <PincodeSection
                      defaultPincodes={analytics?.pincodes}
                      defaultSummary={analytics?.pincodeSummary}
                    />
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
                        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{filteredTransactions.length} transactions</span>
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
                          {filteredTransactions.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>No transactions match the selected filters.</td></tr>
                          ) : filteredTransactions.map((tx) => {
                            const dispStatus = TX_STATUS_LABELS[tx.status] || tx.status
                            const statusClass = TX_STATUS_CLASSES[tx.status] || 'badge-info'
                            return (
                              <tr key={tx.id} className="transition-colors hover:bg-purple-500/5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td className="px-4 py-3 font-bold text-purple-500">{tx.name}</td>
                                <td className="px-4 py-3 font-medium" style={{ color: 'var(--foreground)' }}>{tx.customer}</td>
                                <td className="px-4 py-3" style={{ color: 'var(--foreground-muted)' }}>
                                  {new Date(tx.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tx.paymentType === 'cod' ? 'badge-warning' : 'badge-success'}`}>
                                    {tx.payment}
                                  </span>
                                </td>
                                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusClass}`}>{dispStatus}</span></td>
                                <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--foreground)' }}>₹{tx.value.toLocaleString('en-IN')}</td>
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
                    <StatCard label="Settled & Received" value={fmt(metrics.codSettledRevenue)} icon={CheckCircle} color="bg-emerald-500/10 text-emerald-500" trend={{ dir: 'up', text: `${codRemittance?.settledPct ?? 0}% settled` }} />
                    <StatCard label="Pending Collection" value={fmt(metrics.codPendingRevenue)} icon={Clock} color="bg-yellow-500/10 text-yellow-500" sub={`${metrics.codPendingCount} in transit`} />
                    <StatCard label="RTO Unrealized" value={fmt(metrics.codRtoRevenue)} icon={XCircle} color="bg-red-500/10 text-red-500" trend={{ dir: 'down', text: `${metrics.codRtoCount} RTO orders` }} />
                  </div>

                  {/* Remittance Progress Bar */}
                  <div className="crm-card p-5 mb-5">
                    <p className="text-xs font-bold mb-3" style={{ color: 'var(--foreground-muted)' }}>Remittance Allocation Breakdown</p>
                    <div className="w-full h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--border)' }}>
                      <div className="bg-emerald-500 h-full transition-all duration-1000" title="Settled"
                        style={{ width: `${codRemittance?.settledPct ?? 0}%` }} />
                      <div className="bg-amber-400 h-full transition-all duration-1000" title="Pending"
                        style={{ width: `${codRemittance?.pendingPct ?? 0}%` }} />
                      <div className="bg-red-500 h-full transition-all duration-1000" title="RTO"
                        style={{ width: `${codRemittance?.rtoPct ?? 0}%` }} />
                    </div>
                    <div className="flex gap-4 mt-2 text-[10px]">
                      {[
                        { label: 'Settled', color: 'bg-emerald-500', val: `${codRemittance?.settledPct ?? 0}%` },
                        { label: 'Pending', color: 'bg-amber-400', val: `${codRemittance?.pendingPct ?? 0}%` },
                        { label: 'RTO Unrealized', color: 'bg-red-500', val: `${codRemittance?.rtoPct ?? 0}%` },
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
                        {fmt(codRemittance?.estimatedLogisticsCharges ?? 0)}
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
                    <CODTable ledger={analytics?.codLedger || []} />
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
