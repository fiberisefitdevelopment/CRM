'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ScrollText, Search } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { CallStatusBadge, integrationStatusVariant } from '@/components/customer-service/CallStatusBadge'
import { ErrorToast } from '@/components/ErrorToast'
import {
  IntegrationData,
  dateRangeToIso,
  defaultRangeDays,
  fetchIntegrationLogs,
  formatDateTime,
} from '@/lib/customerServiceApi'

export default function IntegrationLogsPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [user, setUser] = useState('')
  const [logs, setLogs] = useState<IntegrationData[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      const data = await fetchIntegrationLogs({
        from,
        to,
        page,
        pageSize: 25,
        search: debouncedSearch,
        status,
        user,
      })
      setLogs(data.logs || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
    } catch (err: any) {
      setError(err?.message || 'Failed to load integration logs')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, page, debouncedSearch, status, user])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [fromDate, toDate, debouncedSearch, status, user])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/30">
                <ScrollText className="w-5 h-5 text-purple-400" />
              </div>
              Integration Logs
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Track CRM integration status for each call
            </p>
          </div>

          <SubNav />

          <DateRangeBar
            fromDate={fromDate}
            toDate={toDate}
            onFromChange={setFromDate}
            onToChange={setToDate}
            onRefresh={load}
            loading={loading}
          />

          <div className="bg-card rounded-2xl border border-white/10 p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search call ID, number, error…"
                className="crm-input w-full pl-10 pr-3 py-2.5 text-sm"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="crm-input px-3 py-2.5 text-sm"
            >
              <option value="">Status: All</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="PENDING">PENDING</option>
              <option value="RETRY">RETRY</option>
            </select>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="User"
              className="crm-input px-3 py-2.5 text-sm"
            />
          </div>

          <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-white/10">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                    <th className="px-4 py-3 font-bold w-8" />
                    <th className="px-4 py-3 font-bold">Call ID</th>
                    <th className="px-4 py-3 font-bold">Customer Number</th>
                    <th className="px-4 py-3 font-bold">User</th>
                    <th className="px-4 py-3 font-bold">Start Time</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Created</th>
                    <th className="px-4 py-3 font-bold">Updated</th>
                    <th className="px-4 py-3 font-bold">Error Message</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="h-4 bg-white/10 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-16 text-center text-white/40">
                        No integration logs found
                      </td>
                    </tr>
                  ) : (
                    logs.map((log, idx) => {
                      const rowKey = `${log.callId}-${idx}`
                      const hasError = Boolean(log.integrationLogErrorMessage)
                      const isOpen = expanded[rowKey]
                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className="border-b border-white/5 hover:bg-white/[0.03]"
                          >
                            <td className="px-4 py-3">
                              {hasError && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpanded((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
                                  }
                                  className="text-white/40 hover:text-white"
                                >
                                  {isOpen ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-white/70">
                              {log.callId || '—'}
                            </td>
                            <td className="px-4 py-3 text-white">
                              {log.callFormatted || log.callNumber || '—'}
                            </td>
                            <td className="px-4 py-3 text-white/70">{log.userName || '—'}</td>
                            <td className="px-4 py-3 text-white/70">
                              {formatDateTime(log.callStartTime)}
                            </td>
                            <td className="px-4 py-3">
                              <CallStatusBadge
                                label={log.integrationLogStatus || 'UNKNOWN'}
                                variant={integrationStatusVariant(log.integrationLogStatus)}
                              />
                            </td>
                            <td className="px-4 py-3 text-white/60">
                              {formatDateTime(log.integrationLogCreated)}
                            </td>
                            <td className="px-4 py-3 text-white/60">
                              {formatDateTime(log.integrationLogUpdated)}
                            </td>
                            <td className="px-4 py-3 text-white/50 max-w-xs truncate">
                              {log.integrationLogErrorMessage || '—'}
                            </td>
                          </tr>
                          {hasError && isOpen && (
                            <tr className="bg-red-500/5 border-b border-white/5">
                              <td colSpan={9} className="px-6 py-4">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-red-400 mb-1">
                                  Error Message
                                </p>
                                <pre className="text-sm text-red-200/90 whitespace-pre-wrap break-words font-sans">
                                  {log.integrationLogErrorMessage}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-sm text-white/50">
              <span>
                {total} log{total === 1 ? '' : 's'} · Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  )
}
