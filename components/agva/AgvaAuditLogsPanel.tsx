'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/auth'
import { Loader2, Search, ShieldCheck } from 'lucide-react'

interface AuditRow {
  id: string
  userEmail: string
  userRole: string
  actionType: string
  description: string
  module: string
  status: string
  timestamp: string
}

interface Pagination {
  page: number
  per_page: number
  total: number
  total_pages: number
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function AgvaAuditLogsPanel() {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: '25',
      })
      if (query.trim()) params.set('search', query.trim())
      const res = await apiFetch(`/api/agva/audit-logs?${params.toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load audit logs')
      setLogs(data.logs || [])
      setPagination(data.pagination || null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [page, query])

  useEffect(() => {
    load()
  }, [load])

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setQuery(search)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-500" />
        Activity for Agva accounts only (@agvahealthtech.com).
      </p>

      <form onSubmit={onSearchSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, action, description…"
            className="crm-input w-full pl-10 py-2.5 text-sm"
          />
        </div>
        <button type="submit" className="btn-primary px-5 py-2.5 text-sm">
          Search
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="crm-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 text-teal-500 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted">No audit entries yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr
                  className="border-b text-xs uppercase tracking-wide"
                  style={{ borderColor: 'var(--sidebar-border)', color: 'var(--foreground-muted)' }}
                >
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-white/[0.02]"
                    style={{ borderColor: 'var(--sidebar-border)' }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatWhen(row.timestamp)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.userEmail}</div>
                      <div className="text-xs text-muted capitalize">{row.userRole.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-teal-500/10 text-teal-700 dark:text-teal-300">
                        {row.actionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md text-muted">{row.description}</td>
                    <td className="px-4 py-3 capitalize">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {pagination.page} of {pagination.total_pages} · {pagination.total} events
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-theme disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pagination.total_pages}
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
