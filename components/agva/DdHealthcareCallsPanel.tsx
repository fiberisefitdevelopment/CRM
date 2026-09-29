'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/auth'
import {
  Loader2,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react'

interface CallRow {
  id: string
  agentEmail: string
  callLogId: string
  phone: string
  name: string
  location: string
  category: string
  serviceType: string
  direction: string
  durationSec: number | null
  feedback: string
  recordingUrl: string
  recordingStoragePath: string
  localRecordingPath: string
  createdAt: string | null
  updatedAt: string | null
}

interface Pagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

const thClass =
  'px-3 py-3 font-semibold whitespace-nowrap'
const tdClass = 'px-3 py-3 align-middle border-t border-theme'

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null || sec < 0) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatLabel(raw: string): string {
  if (!raw) return '—'
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function DirectionBadge({ direction }: { direction: string }) {
  const d = direction.toLowerCase()
  const outgoing = d === 'outgoing' || d === 'outbound'
  const incoming = d === 'incoming' || d === 'inbound'
  if (outgoing) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300 whitespace-nowrap">
        <ArrowUpRight className="w-3 h-3" />
        Out
      </span>
    )
  }
  if (incoming) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 whitespace-nowrap">
        <ArrowDownLeft className="w-3 h-3" />
        In
      </span>
    )
  }
  return (
    <span className="text-[11px] text-muted capitalize whitespace-nowrap">{direction || '—'}</span>
  )
}

function CallsTable({ rows }: { rows: CallRow[] }) {
  return (
    <div className="crm-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm text-left">
          <thead>
            <tr
              className="text-[10px] uppercase tracking-wide border-b"
              style={{ borderColor: 'var(--sidebar-border)', color: 'var(--foreground-muted)' }}
            >
              <th className={thClass}>Caller</th>
              <th className={thClass}>Phone</th>
              <th className={thClass}>Created</th>
              <th className={thClass}>Log ID</th>
              <th className={thClass}>Dir.</th>
              <th className={thClass}>Dur.</th>
              <th className={thClass}>Agent</th>
              <th className={thClass}>Location</th>
              <th className={thClass}>Category</th>
              <th className={thClass}>Service</th>
              <th className={thClass}>Feedback</th>
              <th className={`${thClass} min-w-[220px]`}>Recording</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/[0.02]">
                <td className={`${tdClass} font-medium max-w-[9rem] truncate`} title={row.name}>
                  {row.name || '—'}
                </td>
                <td className={`${tdClass} font-medium whitespace-nowrap text-teal-600 dark:text-teal-400`}>
                  {row.phone || '—'}
                </td>
                <td className={`${tdClass} whitespace-nowrap text-muted text-xs`}>
                  {formatWhen(row.createdAt)}
                </td>
                <td className={`${tdClass} font-mono text-xs`}>{row.callLogId || '—'}</td>
                <td className={tdClass}>
                  <DirectionBadge direction={row.direction} />
                </td>
                <td className={`${tdClass} text-muted whitespace-nowrap`}>
                  {formatDuration(row.durationSec)}
                </td>
                <td className={`${tdClass} text-xs max-w-[10rem] truncate`} title={row.agentEmail}>
                  {row.agentEmail || '—'}
                </td>
                <td className={`${tdClass} capitalize max-w-[6rem] truncate`} title={row.location}>
                  {row.location || '—'}
                </td>
                <td className={`${tdClass} text-xs max-w-[7rem] truncate`} title={row.category}>
                  {formatLabel(row.category)}
                </td>
                <td className={`${tdClass} text-xs max-w-[8rem] truncate`} title={row.serviceType}>
                  {row.serviceType || '—'}
                </td>
                <td className={`${tdClass} text-xs text-muted max-w-[10rem]`}>
                  <span className="line-clamp-2" title={row.feedback}>
                    {row.feedback || '—'}
                  </span>
                </td>
                <td className={tdClass}>
                  {row.recordingUrl ? (
                    <audio
                      controls
                      preload="none"
                      className="w-[min(220px,100%)] h-8"
                      src={row.recordingUrl}
                      title={row.recordingStoragePath || undefined}
                    />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DdHealthcareCallsPanel() {
  const [calls, setCalls] = useState<CallRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [locations, setLocations] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [callType, setCallType] = useState<'all' | 'service' | 'sales_enquiry' | 'spam'>('all')
  const [location, setLocation] = useState('')
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: '25',
        call_type: callType,
        date_range: dateRange,
      })
      if (search) params.set('search', search)
      if (location) params.set('location', location)
      if (dateRange === 'custom') {
        if (dateFrom) params.set('date_from', dateFrom)
        if (dateTo) params.set('date_to', dateTo)
      }

      const res = await apiFetch(`/api/agva/dd-healthcare/calls?${params.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load calls')
      setCalls(data.calls || [])
      setPagination(data.pagination || null)
      if (data.facets?.locations) setLocations(data.facets.locations)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load calls')
      setCalls([])
    } finally {
      setLoading(false)
    }
  }, [page, search, callType, location, dateRange, dateFrom, dateTo])

  useEffect(() => {
    load()
  }, [load])

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setCallType('all')
    setLocation('')
    setDateRange('all')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const hasActiveFilters =
    Boolean(search) ||
    callType !== 'all' ||
    Boolean(location) ||
    dateRange !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo)

  const selectClass =
    'crm-input w-full py-2 px-3 text-sm appearance-none cursor-pointer'

  return (
    <div className="space-y-4">
      <div className="crm-card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Filters &amp; search
          </p>
          {pagination ? (
            <p className="text-xs text-muted">
              Showing {calls.length} on this page · {pagination.total} matching
              {hasActiveFilters ? ' (filtered)' : ''}
            </p>
          ) : null}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, phone, agent, call log ID, feedback…"
            className="crm-input w-full pl-10 py-2.5 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">Call type</span>
            <select
              value={callType}
              onChange={(e) => {
                setCallType(e.target.value as typeof callType)
                setPage(1)
              }}
              className={selectClass}
            >
              <option value="all">All</option>
              <option value="service">Service</option>
              <option value="sales_enquiry">Sales enquiry</option>
              <option value="spam">Spam</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">Location</span>
            <select
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                setPage(1)
              }}
              className={selectClass}
            >
              <option value="">All locations</option>
              {locations.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">Date</span>
            <select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value as typeof dateRange)
                setPage(1)
              }}
              className={selectClass}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
        </div>

        {dateRange === 'custom' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className={selectClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className={selectClass}
              />
            </label>
          </div>
        ) : null}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
          >
            Clear all filters
          </button>
        ) : null}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="crm-card flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-teal-500 animate-spin" />
        </div>
      ) : calls.length === 0 ? (
        <div className="crm-card py-16 text-center text-sm text-muted">No calls found.</div>
      ) : (
        <CallsTable rows={calls} />
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {pagination.page} of {pagination.total_pages} · {pagination.total} calls
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || pagination.total_pages <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-theme disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pagination.total_pages || pagination.total_pages <= 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-theme disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
