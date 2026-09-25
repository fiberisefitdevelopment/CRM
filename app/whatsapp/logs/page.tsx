'use client'

import { useState, useEffect, useCallback } from 'react'
import { SubNav } from '@/components/whatsapp/SubNav'
import { StatusBadge } from '@/components/whatsapp/StatusBadge'
import { fetchLogs, retryMessage } from '@/lib/whatsappApi'
import {
  Loader2,
  Search,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Phone,
  Tag,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogRow {
  id: string
  customerId: string
  journeyId: string
  phone: string
  templateName: string
  status: string
  sentAt: string | null
  error: string | null
  response: string | null
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const loadLogs = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const data = await fetchLogs({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 200,
      })
      setLogs(data || [])
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const handleRetry = async (logId: string) => {
    setRetryingId(logId)
    try {
      await retryMessage(logId)
      await loadLogs()
    } catch (err) {
      console.error('Retry failed:', err)
    } finally {
      setRetryingId(null)
    }
  }

  // Search filter
  const filtered = logs.filter((log) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      log.phone.includes(q) ||
      log.templateName.toLowerCase().includes(q) ||
      (log.error && log.error.toLowerCase().includes(q))
    )
  })

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // Stats
  const totalSent = logs.filter((l) => l.status === 'sent').length
  const totalFailed = logs.filter((l) => l.status === 'failed').length

  return (
    <div className="min-h-screen bg-background">
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-500/30">
                    <ScrollText className="w-5 h-5 text-emerald-400" />
                  </div>
                  Message Logs
                </h1>
                <p className="text-white/50 text-sm mt-1">
                  Track WhatsApp message delivery status and retry failures
                </p>
              </div>
              <button
                onClick={() => loadLogs(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all"
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>

          {/* Sub Navigation */}
          <SubNav />

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-xl p-4 border border-white/10">
              <p className="text-white/40 text-xs font-semibold">Total Logs</p>
              <p className="text-2xl font-bold text-white mt-1">{logs.length}</p>
            </div>
            <div className="bg-card rounded-xl p-4 border border-white/10">
              <p className="text-emerald-400/60 text-xs font-semibold">Delivered</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{totalSent}</p>
            </div>
            <div className="bg-card rounded-xl p-4 border border-white/10">
              <p className="text-red-400/60 text-xs font-semibold">Failed</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{totalFailed}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-card rounded-2xl p-4 border border-white/10 mb-6">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
              <div className="flex-1 w-full md:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="Search by phone, template name, error..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {['all', 'sent', 'failed', 'pending'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                      statusFilter === s
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Logs Table */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                <p className="text-white/50">Loading logs...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-card rounded-2xl p-12 border border-white/10 text-center">
              <ScrollText className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg mb-2">No Message Logs</h3>
              <p className="text-white/30 text-sm">
                Logs will appear here when WhatsApp messages are sent.
              </p>
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Phone</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Template</th>
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-white/40 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Sent At</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Error</th>
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-white/40 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filtered.map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3.5">
                          <p className="text-white text-sm flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-white/30" />
                            {log.phone}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="text-white/70 text-xs font-mono flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5 text-white/30" />
                            {log.templateName}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <StatusBadge status={log.status} />
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="text-white/50 text-xs flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-white/30" />
                            {formatDate(log.sentAt)}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          {log.error ? (
                            <p className="text-red-400/70 text-xs flex items-start gap-1.5 max-w-[200px]">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400/50 flex-shrink-0 mt-0.5" />
                              <span className="truncate">{log.error}</span>
                            </p>
                          ) : (
                            <span className="text-white/20 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {log.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(log.id)}
                              disabled={retryingId === log.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-amber-400 text-[11px] font-bold transition-all disabled:opacity-50"
                            >
                              {retryingId === log.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02]">
                <p className="text-white/30 text-xs">
                  Showing {filtered.length} of {logs.length} logs
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
