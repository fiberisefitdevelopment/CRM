'use client'

import { apiFetch } from '@/lib/auth'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import {
  ShieldCheck,
  Search,
  RefreshCw,
  Terminal,
  Eye,
  X,
  Clock,
  User,
  Globe,
  Smartphone,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  LogIn,
  LogOut,
  Package,
  MessageSquare,
  Settings,
  Shield,
  Monitor,
  Activity,
  Filter,
  LayoutList,
  Table2,
  XCircle,
  CheckCircle,
  Calendar,
  Loader2,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string
  userId: string
  userEmail: string
  userName: string
  userRole: string
  sessionId: string
  actionType: string
  description: string
  module: string
  status: 'success' | 'failure'
  method: string
  path: string
  ipAddress: string
  userAgent: string
  device: string
  os: string
  browser: string
  changes?: { before?: any; after?: any }
  details: any
  timestamp: string
}

interface PaginationInfo {
  page: number
  per_page: number
  total: number
  total_pages: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOGS_PER_PAGE = 25

const ACTION_CATEGORIES = [
  { value: 'ALL', label: 'All Events' },
  { value: 'AUTH', label: 'Authentication' },
  { value: 'ORDERS', label: 'Orders' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SYSTEM', label: 'System' },
]

const MODULE_OPTIONS = [
  { value: 'all', label: 'All Modules' },
  { value: 'auth', label: 'Auth' },
  { value: 'orders', label: 'Orders' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'crm', label: 'CRM' },
  { value: 'admin', label: 'Admin' },
  { value: 'system', label: 'System' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
]

// ─── Helper Functions ────────────────────────────────────────────────────────

function getActionIcon(actionType: string) {
  if (actionType.includes('LOGIN') || actionType === 'USER_LOGIN') return <LogIn className="w-4 h-4" />
  if (actionType === 'USER_LOGOUT') return <LogOut className="w-4 h-4" />
  if (actionType.includes('ORDER')) return <Package className="w-4 h-4" />
  if (actionType.includes('TEMPLATE') || actionType.includes('JOURNEY')) return <MessageSquare className="w-4 h-4" />
  if (actionType.includes('ADMIN') || actionType.includes('ROLE')) return <Shield className="w-4 h-4" />
  return <Settings className="w-4 h-4" />
}

function getActionColor(actionType: string, status: string) {
  if (status === 'failure') return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-500' }
  switch (actionType) {
    case 'USER_LOGIN':
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-500' }
    case 'USER_LOGOUT':
      return { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', dot: 'bg-cyan-500' }
    case 'LOGIN_FAILED':
      return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-500' }
    case 'ORDER_CREATE':
    case 'ORDER_CLONE':
      return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-500' }
    case 'ORDER_CANCEL':
    case 'BULK_ORDER_CANCEL':
      return { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30', dot: 'bg-rose-500' }
    case 'CREATE_TEMPLATE':
      return { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/30', dot: 'bg-violet-500' }
    case 'UPDATE_TEMPLATE':
      return { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30', dot: 'bg-indigo-500' }
    case 'DELETE_TEMPLATE':
      return { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30', dot: 'bg-rose-500' }
    case 'UPDATE_JOURNEY_STATUS':
      return { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-500' }
    default:
      return { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-500' }
  }
}

function getModuleBadge(module: string) {
  const map: Record<string, { icon: React.ReactNode; color: string }> = {
    auth: { icon: <Shield className="w-3 h-3" />, color: 'text-blue-400' },
    orders: { icon: <Package className="w-3 h-3" />, color: 'text-purple-400' },
    whatsapp: { icon: <MessageSquare className="w-3 h-3" />, color: 'text-green-400' },
    crm: { icon: <User className="w-3 h-3" />, color: 'text-amber-400' },
    admin: { icon: <ShieldCheck className="w-3 h-3" />, color: 'text-red-400' },
    system: { icon: <Settings className="w-3 h-3" />, color: 'text-slate-400' },
  }
  return map[module] || map.system
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return dateStr
  }
}

function timeAgo(dateStr: string) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return formatDate(dateStr)
  } catch {
    return dateStr
  }
}

function getRoleBadgeColor(role: string) {
  if (role === 'super_admin') return 'bg-red-500/10 text-red-400 border-red-500/25'
  if (role === 'admin') return 'bg-amber-500/10 text-amber-400 border-amber-500/25'
  return 'bg-slate-500/10 text-slate-400 border-slate-500/25'
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  // View mode
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table')

  // Data
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, per_page: LOGS_PER_PAGE, total: 0, total_pages: 1 })
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedActionType, setSelectedActionType] = useState('ALL')
  const [selectedModule, setSelectedModule] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [filterUser, setFilterUser] = useState('')
  const [filterIp, setFilterIp] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // UI
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  // Refs
  const fetchRef = useRef<AbortController | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, selectedActionType, selectedModule, selectedStatus, filterUser, filterIp, startDate, endDate])

  // Fetch logs
  const fetchLogs = useCallback(async (page: number, isInitial = false) => {
    if (fetchRef.current) fetchRef.current.abort()
    const controller = new AbortController()
    fetchRef.current = controller

    try {
      if (isInitial) setLoading(true)
      else setPageLoading(true)

      const params = new URLSearchParams({
        page: String(page),
        per_page: String(LOGS_PER_PAGE),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (selectedActionType !== 'ALL') params.set('action_type', selectedActionType)
      if (selectedModule !== 'all') params.set('module', selectedModule)
      if (selectedStatus !== 'all') params.set('status', selectedStatus)
      if (filterUser.trim()) params.set('user', filterUser.trim())
      if (filterIp.trim()) params.set('ip', filterIp.trim())
      if (startDate) params.set('start_date', startDate)
      if (endDate) params.set('end_date', endDate)

      const res = await apiFetch(`/api/audit-logs?${params.toString()}`, { signal: controller.signal })
      const data = await res.json()

      if (data.success && data.logs) {
        setLogs(data.logs)
        if (data.pagination) setPagination(data.pagination)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('Failed to fetch audit logs:', err)
    } finally {
      setLoading(false)
      setPageLoading(false)
      setRefreshing(false)
    }
  }, [debouncedSearch, selectedActionType, selectedModule, selectedStatus, filterUser, filterIp, startDate, endDate])

  // Initial + reactive fetch
  useEffect(() => {
    fetchLogs(currentPage, currentPage === 1 && logs.length === 0)
  }, [currentPage, fetchLogs])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchLogs(currentPage)
  }

  const handleCopyPayload = (payload: any) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    setCopiedId('payload')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const isSuspicious = (log: AuditLog) => {
    return log.actionType === 'LOGIN_FAILED' || log.status === 'failure'
  }

  const isSuperAdmin = (log: AuditLog) => {
    return log.userRole === 'super_admin' || log.userEmail === 'superadmin@fiberisefit.com'
  }

  const activeFiltersCount = [
    selectedActionType !== 'ALL',
    selectedModule !== 'all',
    selectedStatus !== 'all',
    filterUser.trim() !== '',
    filterIp.trim() !== '',
    startDate !== '',
    endDate !== '',
  ].filter(Boolean).length

  const clearFilters = () => {
    setSelectedActionType('ALL')
    setSelectedModule('all')
    setSelectedStatus('all')
    setFilterUser('')
    setFilterIp('')
    setStartDate('')
    setEndDate('')
    setSearchTerm('')
  }

  // Pagination
  const goToPage = (p: number) => { if (p >= 1 && p <= pagination.total_pages) setCurrentPage(p) }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex">
      <Sidebar />
      <main className="flex-1 lg:pl-64 min-w-0">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-5">

          {/* ── Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  Security Audit Logs
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Immutable trace logs — every action across Fiberise Fit is recorded here.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-2.5 text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'table' ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white'}`}
                >
                  <Table2 className="w-3.5 h-3.5" /> Table
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-2.5 text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'timeline' ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white'}`}
                >
                  <LayoutList className="w-3.5 h-3.5" /> Timeline
                </button>
              </div>
              <button
                onClick={handleRefresh}
                disabled={loading || refreshing}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white rounded-xl border border-white/10 transition-all font-medium text-sm shadow-md"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* ── Search & Filter Bar ── */}
          <div className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by user, action, description, IP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#0e121a]/80 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
                />
              </div>

              {/* Quick filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedActionType}
                  onChange={(e) => setSelectedActionType(e.target.value)}
                  className="bg-[#0e121a]/80 border border-white/10 rounded-xl px-3 py-3 text-xs text-white focus:outline-none focus:border-purple-500/50 transition-all cursor-pointer"
                >
                  {ACTION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="bg-[#0e121a]/80 border border-white/10 rounded-xl px-3 py-3 text-xs text-white focus:outline-none focus:border-purple-500/50 transition-all cursor-pointer"
                >
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-1.5 px-3 py-3 rounded-xl border text-xs font-medium transition-all ${
                    showFilters || activeFiltersCount > 0
                      ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filters
                  {activeFiltersCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 bg-purple-500/30 text-purple-200 text-[10px] rounded-full font-bold">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {activeFiltersCount > 0 && (
                  <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all">
                    <XCircle className="w-3.5 h-3.5" /> Clear All
                  </button>
                )}
              </div>
            </div>

            {/* Advanced Filters Panel */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-[#0e121a]/60 border border-white/5 rounded-xl p-4 animate-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">Module</label>
                  <select
                    value={selectedModule}
                    onChange={(e) => setSelectedModule(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50"
                  >
                    {MODULE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">User Email</label>
                  <input
                    type="text"
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    placeholder="admin@fiberisefit.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">IP Address</label>
                  <input
                    type="text"
                    value={filterIp}
                    onChange={(e) => setFilterIp(e.target.value)}
                    placeholder="192.168.1.1"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">From</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50 [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5 font-semibold">To</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-purple-500/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Main Content Card ── */}
          <div className="bg-card border border-white/10 rounded-2xl overflow-hidden shadow-2xl relative">
            {/* Page transition overlay */}
            {pageLoading && (
              <div className="absolute inset-0 bg-[#07090e]/60 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-5 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  <span className="text-sm text-white/70 font-medium">Loading audit data...</span>
                </div>
              </div>
            )}

            {loading ? (
              /* Skeleton loading */
              <div className="overflow-hidden">
                <div className="grid grid-cols-6 gap-4 px-6 py-4 border-b border-white/5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-3 bg-white/5 rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
                  ))}
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-6 gap-4 px-6 py-5 border-b border-white/5" style={{ opacity: 1 - i * 0.08 }}>
                    <div className="space-y-2"><div className="h-3 w-24 bg-white/8 rounded animate-pulse" /><div className="h-2.5 w-16 bg-white/5 rounded animate-pulse" /></div>
                    <div className="space-y-2"><div className="h-3 w-28 bg-white/8 rounded animate-pulse" /><div className="h-2.5 w-20 bg-white/5 rounded animate-pulse" /></div>
                    <div className="h-6 w-24 bg-white/5 rounded-md animate-pulse" />
                    <div className="h-3 w-32 bg-white/5 rounded animate-pulse" />
                    <div className="space-y-2"><div className="h-3 w-20 bg-white/8 rounded animate-pulse" /><div className="h-2.5 w-28 bg-white/5 rounded animate-pulse" /></div>
                    <div className="h-7 w-16 bg-white/5 rounded-lg animate-pulse" />
                  </div>
                ))}
                <div className="py-4 text-center">
                  <p className="text-xs text-white/30 font-medium animate-pulse">Loading audit trace data from secure collection...</p>
                </div>
              </div>
            ) : logs.length === 0 ? (
              /* Empty state */
              <div className="p-16 text-center flex flex-col items-center justify-center space-y-4">
                <div className="p-4 bg-white/5 rounded-full text-slate-500">
                  <Terminal className="w-8 h-8" />
                </div>
                <p className="text-white font-semibold text-lg">No audit logs found</p>
                <p className="text-slate-400 text-sm max-w-md mx-auto">
                  Try adjusting your filters, expanding the date range, or clearing all filters.
                </p>
                {activeFiltersCount > 0 && (
                  <button onClick={clearFilters} className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-all">
                    Clear All Filters
                  </button>
                )}
              </div>
            ) : viewMode === 'table' ? (
              /* ═══ TABLE VIEW ═══ */
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-xs font-semibold text-slate-400 uppercase bg-white/[0.02] select-none">
                      <th className="px-5 py-4"><span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Timestamp</span></th>
                      <th className="px-5 py-4"><span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> User</span></th>
                      <th className="px-5 py-4">Action</th>
                      <th className="px-5 py-4">Description</th>
                      <th className="px-5 py-4"><span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Network</span></th>
                      <th className="px-5 py-4 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm">
                    {logs.map((log) => {
                      const colors = getActionColor(log.actionType, log.status)
                      const suspicious = isSuspicious(log)
                      const superAdmin = isSuperAdmin(log)
                      const expanded = expandedLogId === log.id

                      return (
                        <tr key={log.id} className="group">
                          {/* Wrapper row */}
                          <td colSpan={6} className="p-0">
                            {/* Main row content */}
                            <div
                              className={`grid grid-cols-[180px_200px_160px_1fr_200px_80px] items-center transition-colors cursor-pointer ${
                                suspicious
                                  ? 'bg-gradient-to-r from-red-500/[0.04] to-transparent hover:from-red-500/[0.07]'
                                  : superAdmin
                                  ? 'bg-gradient-to-r from-amber-500/[0.03] to-transparent hover:from-amber-500/[0.05]'
                                  : 'hover:bg-white/[0.02]'
                              }`}
                              onClick={() => setExpandedLogId(expanded ? null : log.id)}
                            >
                              {/* Timestamp */}
                              <div className={`px-5 py-4 ${suspicious ? 'border-l-3 border-l-red-500/70' : superAdmin ? 'border-l-3 border-l-amber-500/40' : ''}`}>
                                <div className="text-xs text-slate-300 font-mono">{formatDate(log.timestamp)}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{timeAgo(log.timestamp)}</div>
                              </div>

                              {/* User */}
                              <div className="px-5 py-4">
                                <div className={`text-xs font-medium truncate ${superAdmin ? 'text-amber-200' : 'text-white'}`}>
                                  {log.userName || log.userEmail?.split('@')[0]}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate">{log.userEmail}</div>
                                <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${getRoleBadgeColor(log.userRole)}`}>
                                  {log.userRole?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                                </span>
                              </div>

                              {/* Action Badge */}
                              <div className="px-5 py-4">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono border ${colors.bg} ${colors.text} ${colors.border}`}>
                                  {getActionIcon(log.actionType)}
                                  {log.actionType}
                                </span>
                                {log.status === 'failure' && (
                                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-red-400 font-semibold">
                                    <AlertTriangle className="w-3 h-3" /> FAILED
                                  </div>
                                )}
                              </div>

                              {/* Description */}
                              <div className="px-5 py-4">
                                <div className="text-xs text-slate-300 truncate max-w-xs" title={log.description}>
                                  {log.description || '—'}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  {(() => { const mb = getModuleBadge(log.module); return (
                                    <span className={`inline-flex items-center gap-1 text-[10px] ${mb.color}`}>
                                      {mb.icon} {log.module}
                                    </span>
                                  )})()}
                                  <span className="text-[10px] text-slate-600 font-mono">{log.method} {log.path}</span>
                                </div>
                              </div>

                              {/* Network */}
                              <div className="px-5 py-4">
                                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
                                  <span className={`w-1.5 h-1.5 rounded-full ${suspicious ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`} />
                                  {log.ipAddress || 'N/A'}
                                </div>
                                <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                  <Monitor className="w-3 h-3 flex-shrink-0" />
                                  {log.browser || 'Unknown'} · {log.os || 'Unknown'}
                                </div>
                              </div>

                              {/* Expand button */}
                              <div className="px-5 py-4 text-right">
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all ${expanded ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-slate-400 group-hover:text-white'}`}>
                                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </span>
                              </div>
                            </div>

                            {/* Expanded details */}
                            {expanded && (
                              <div className="bg-[#0a0d14] border-t border-white/5 px-6 py-5 animate-in slide-in-from-top-1 duration-200">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                  <InfoCard label="User ID" value={log.userId} mono />
                                  <InfoCard label="Session ID" value={log.sessionId || 'N/A'} mono />
                                  <InfoCard label="Device" value={`${log.device || 'Unknown'}`} />
                                  <InfoCard label="Full User Agent" value={log.userAgent || 'N/A'} mono truncate />
                                </div>

                                {/* Changes diff */}
                                {log.changes && (log.changes.before || log.changes.after) && (
                                  <div className="mb-4">
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Data Changes</div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {log.changes.before && (
                                        <div>
                                          <div className="text-[10px] text-red-400 font-semibold mb-1">Before</div>
                                          <pre className="bg-red-500/5 border border-red-500/10 rounded-lg p-3 text-[11px] font-mono text-red-300 overflow-x-auto max-h-40">
                                            {JSON.stringify(log.changes.before, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                      {log.changes.after && (
                                        <div>
                                          <div className="text-[10px] text-emerald-400 font-semibold mb-1">After</div>
                                          <pre className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                                            {JSON.stringify(log.changes.after, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Details payload */}
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Payload</span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleCopyPayload(log.details) }}
                                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-purple-400 transition-colors"
                                      >
                                        {copiedId === 'payload' ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied!</span></> : <><Copy className="w-3 h-3" /> Copy</>}
                                      </button>
                                    </div>
                                    <pre className="bg-[#080a0f] border border-white/10 rounded-lg p-3 text-[11px] font-mono text-purple-300 overflow-x-auto max-h-48">
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ═══ TIMELINE VIEW ═══ */
              <div className="px-6 py-4 space-y-0">
                {logs.map((log, idx) => {
                  const colors = getActionColor(log.actionType, log.status)
                  const suspicious = isSuspicious(log)
                  const expanded = expandedLogId === log.id

                  return (
                    <div key={log.id} className="relative pl-8">
                      {/* Timeline line */}
                      {idx < logs.length - 1 && (
                        <div className="absolute left-[15px] top-10 bottom-0 w-px bg-white/5" />
                      )}
                      {/* Timeline dot */}
                      <div className={`absolute left-[8px] top-4 w-4 h-4 rounded-full border-2 border-[#07090e] ${colors.dot} ${suspicious ? 'animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)]' : ''}`} />

                      <div
                        className={`py-4 cursor-pointer group transition-all rounded-xl px-4 -ml-2 ${
                          suspicious ? 'hover:bg-red-500/[0.04]' : 'hover:bg-white/[0.02]'
                        }`}
                        onClick={() => setExpandedLogId(expanded ? null : log.id)}
                      >
                        {/* Timeline header */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {getActionIcon(log.actionType)}
                                {log.actionType}
                              </span>
                              {log.status === 'failure' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                  <AlertTriangle className="w-3 h-3" /> FAILED
                                </span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getRoleBadgeColor(log.userRole)}`}>
                                {log.userRole?.replace('_', ' ').toUpperCase()}
                              </span>
                            </div>
                            <p className="text-sm text-white mt-1.5">{log.description || log.actionType}</p>
                            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                              <span className="font-medium text-slate-400">{log.userEmail}</span>
                              <span>·</span>
                              <span className="font-mono">{log.ipAddress}</span>
                              <span>·</span>
                              <span>{log.browser} / {log.os}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs text-slate-400">{timeAgo(log.timestamp)}</div>
                            <div className="text-[10px] text-slate-600 font-mono mt-0.5">{formatDate(log.timestamp)}</div>
                          </div>
                        </div>

                        {/* Timeline expanded */}
                        {expanded && (
                          <div className="mt-4 bg-[#0a0d14] border border-white/5 rounded-xl p-4 animate-in slide-in-from-top-1 duration-200">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-[11px]">
                              <InfoCard label="Method · Path" value={`${log.method} ${log.path}`} mono />
                              <InfoCard label="Device" value={log.device} />
                              <InfoCard label="Session ID" value={log.sessionId || 'N/A'} mono />
                              <InfoCard label="User Agent" value={log.userAgent} mono truncate />
                            </div>
                            {log.details && Object.keys(log.details).length > 0 && (
                              <pre className="bg-[#080a0f] border border-white/10 rounded-lg p-3 text-[11px] font-mono text-purple-300 overflow-x-auto max-h-40">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Footer: Pagination ── */}
            {!loading && logs.length > 0 && (
              <div className="px-6 py-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-[#0c0f17]">
                <span className="text-slate-500">
                  Showing {((pagination.page - 1) * pagination.per_page) + 1}–{Math.min(pagination.page * pagination.per_page, pagination.total)} of {pagination.total} audit records
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5">
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  {(() => {
                    const pages: number[] = []
                    const total = pagination.total_pages
                    let start = Math.max(1, currentPage - 2)
                    let end = Math.min(total, start + 4)
                    start = Math.max(1, end - 4)
                    for (let p = start; p <= end; p++) pages.push(p)
                    return pages.map(p => (
                      <button
                        key={p}
                        onClick={() => goToPage(p)}
                        className={`min-w-[32px] h-8 rounded-lg text-xs font-semibold transition-all border ${
                          p === currentPage
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                            : 'bg-white/5 text-slate-400 hover:text-white border-white/5'
                        }`}
                      >
                        {p}
                      </button>
                    ))
                  })()}
                  <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pagination.total_pages} className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => goToPage(pagination.total_pages)} disabled={currentPage === pagination.total_pages} className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5">
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Security Notice ── */}
          <div className="bg-amber-500/5 border border-amber-500/15 p-4 rounded-xl flex items-start gap-3">
            <span className="text-lg">🔒</span>
            <div>
              <strong className="text-amber-400 text-xs block uppercase tracking-wider mb-0.5">Immutable Record System</strong>
              <p className="text-[11px] text-amber-300/70 leading-relaxed">
                All audit logs are written to a secure Firestore collection and cannot be modified, deleted, or tampered with by any dashboard user — including super administrators.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}

// ─── Small Reusable Components ───────────────────────────────────────────────

function InfoCard({ label, value, mono, truncate: doTruncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-0.5">{label}</div>
      <div className={`text-xs text-slate-300 ${mono ? 'font-mono' : ''} ${doTruncate ? 'truncate' : ''}`} title={doTruncate ? value : undefined}>
        {value || 'N/A'}
      </div>
    </div>
  )
}
