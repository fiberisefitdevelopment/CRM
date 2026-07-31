'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Columns3,
  Copy,
  Download,
  Eye,
  Headphones,
  MoreHorizontal,
  Phone,
  Play,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { CallDetailsDrawer } from '@/components/customer-service/CallDetailsDrawer'
import { CallAudioPlayer } from '@/components/customer-service/CallAudioPlayer'
import { CallStatusBadge, boolBadge } from '@/components/customer-service/CallStatusBadge'
import { ErrorToast } from '@/components/ErrorToast'
import {
  CallData,
  copyText,
  dateRangeToIso,
  defaultRangeDays,
  downloadCallsCsv,
  fetchCalls,
  formatDateTime,
  formatDuration,
  getRecordingStreamUrl,
} from '@/lib/customerServiceApi'

type ColKey =
  | 'callId'
  | 'number'
  | 'formattedNumber'
  | 'phonebookName'
  | 'userName'
  | 'userEmail'
  | 'userPhone'
  | 'startTime'
  | 'createdAt'
  | 'duration'
  | 'answered'
  | 'inbound'
  | 'integrated'
  | 'source'
  | 'sourceDetail'
  | 'recording'

const ALL_COLUMNS: { key: ColKey; label: string; defaultVisible?: boolean }[] = [
  { key: 'callId', label: 'Call ID' },
  { key: 'number', label: 'Customer Number', defaultVisible: true },
  { key: 'formattedNumber', label: 'Formatted Number', defaultVisible: true },
  { key: 'phonebookName', label: 'Phonebook Name' },
  { key: 'userName', label: 'User Name', defaultVisible: true },
  { key: 'userEmail', label: 'User Email' },
  { key: 'userPhone', label: 'User Phone' },
  { key: 'startTime', label: 'Start Time', defaultVisible: true },
  { key: 'createdAt', label: 'Created Time' },
  { key: 'duration', label: 'Duration', defaultVisible: true },
  { key: 'answered', label: 'Answered', defaultVisible: true },
  { key: 'inbound', label: 'Inbound', defaultVisible: true },
  { key: 'integrated', label: 'Integrated', defaultVisible: true },
  { key: 'source', label: 'Source' },
  { key: 'sourceDetail', label: 'Source Detail' },
  { key: 'recording', label: 'Recording', defaultVisible: true },
]

export default function CallHistoryPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [user, setUser] = useState('')
  const [phone, setPhone] = useState('')
  const [answered, setAnswered] = useState('all')
  const [direction, setDirection] = useState('all')
  const [integrated, setIntegrated] = useState('all')
  const [source, setSource] = useState('')
  const [sourceDetail, setSourceDetail] = useState('')
  const [byCreated, setByCreated] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [sortBy, setSortBy] = useState('startTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [calls, setCalls] = useState<CallData[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<CallData | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [colsOpen, setColsOpen] = useState(false)
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(
    ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  )

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      const data = await fetchCalls({
        from,
        to,
        byCreated,
        page,
        pageSize,
        search: debouncedSearch,
        user,
        phone,
        answered,
        direction,
        integrated,
        source,
        sourceDetail,
        sortBy,
        sortDir,
      })
      setCalls(data.calls || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
    } catch (err: any) {
      setError(err?.message || 'Failed to load call history')
    } finally {
      setLoading(false)
    }
  }, [
    fromDate,
    toDate,
    byCreated,
    page,
    pageSize,
    debouncedSearch,
    user,
    phone,
    answered,
    direction,
    integrated,
    source,
    sourceDetail,
    sortBy,
    sortDir,
  ])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [
    fromDate,
    toDate,
    debouncedSearch,
    user,
    phone,
    answered,
    direction,
    integrated,
    source,
    sourceDetail,
    byCreated,
  ])

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const handleExport = async (filtered: boolean) => {
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      await downloadCallsCsv({
        from,
        to,
        byCreated,
        filtered,
        search: debouncedSearch,
        user,
        phone,
        answered,
        direction,
        integrated,
        source,
        sourceDetail,
      })
      setToast(filtered ? 'Filtered CSV exported' : 'CSV exported')
    } catch (err: any) {
      setError(err?.message || 'CSV export failed')
    }
  }

  const columns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  )

  const renderCell = (call: CallData, key: ColKey) => {
    switch (key) {
      case 'callId':
        return <span className="font-mono text-xs">{call.callId.slice(0, 8)}…</span>
      case 'number':
        return call.number || '—'
      case 'formattedNumber':
        return call.formattedNumber || '—'
      case 'phonebookName':
        return call.phonebookName || '—'
      case 'userName':
        return call.userName || '—'
      case 'userEmail':
        return call.userEmail || '—'
      case 'userPhone':
        return call.userPhone || '—'
      case 'startTime':
        return formatDateTime(call.startTime)
      case 'createdAt':
        return formatDateTime(call.createdAt)
      case 'duration':
        return formatDuration(call.duration)
      case 'answered': {
        const b = boolBadge(call.answered, 'Yes', 'No')
        return <CallStatusBadge label={b.label} variant={b.variant} />
      }
      case 'inbound': {
        const b = boolBadge(call.inbound, 'Inbound', 'Outbound')
        return <CallStatusBadge label={b.label} variant={b.variant} />
      }
      case 'integrated': {
        const b = boolBadge(call.integrated, 'Yes', 'No')
        return <CallStatusBadge label={b.label} variant={b.variant} />
      }
      case 'source':
        return call.source || '—'
      case 'sourceDetail':
        return call.sourceDetail || '—'
      case 'recording':
        return call.recUrl ? (
          <CallStatusBadge label="Available" variant="purple" />
        ) : (
          <span className="text-white/30">—</span>
        )
      default:
        return '—'
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/30">
                <Phone className="w-5 h-5 text-purple-400" />
              </div>
              Call History
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Search, filter, and export call records from Salestrail
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
            rightSlot={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleExport(false)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-xl text-emerald-300 text-sm font-semibold"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
                <button
                  onClick={() => handleExport(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold"
                >
                  <Download className="w-4 h-4" />
                  Filtered Export
                </button>
              </div>
            }
          />

          <div className="bg-card rounded-2xl border border-white/10 p-4 mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search call ID, phone, name, email…"
                className="crm-input w-full pl-10 pr-3 py-2.5 text-sm"
              />
            </div>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="User"
              className="crm-input px-3 py-2.5 text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              className="crm-input px-3 py-2.5 text-sm"
            />
            <select
              value={answered}
              onChange={(e) => setAnswered(e.target.value)}
              className="crm-input px-3 py-2.5 text-sm"
            >
              <option value="all">Answered: All</option>
              <option value="true">Answered</option>
              <option value="false">Missed</option>
            </select>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="crm-input px-3 py-2.5 text-sm"
            >
              <option value="all">Direction: All</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select
              value={integrated}
              onChange={(e) => setIntegrated(e.target.value)}
              className="crm-input px-3 py-2.5 text-sm"
            >
              <option value="all">Integrated: All</option>
              <option value="true">Integrated</option>
              <option value="false">Not Integrated</option>
            </select>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Source"
              className="crm-input px-3 py-2.5 text-sm"
            />
            <input
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="Source detail"
              className="crm-input px-3 py-2.5 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-white/60 px-1">
              <input
                type="checkbox"
                checked={byCreated}
                onChange={(e) => setByCreated(e.target.checked)}
                className="rounded"
              />
              Filter by created date
            </label>
            <div className="relative">
              <button
                onClick={() => setColsOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-semibold w-full justify-center"
              >
                <Columns3 className="w-4 h-4" />
                Columns
              </button>
              {colsOpen && (
                <div className="absolute right-0 mt-2 z-20 w-56 bg-[#12172A] border border-white/10 rounded-xl shadow-xl p-2 max-h-72 overflow-y-auto">
                  {ALL_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-sm text-white/80 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleCols.includes(col.key)}
                        onChange={() => {
                          setVisibleCols((prev) =>
                            prev.includes(col.key)
                              ? prev.filter((k) => k !== col.key)
                              : [...prev, col.key],
                          )
                        }}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#0e121a]/95 backdrop-blur border-b border-white/10">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                    {columns.map((col) => (
                      <th key={col.key} className="px-3 py-3 font-bold whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key === 'recording' ? 'startTime' : col.key)}
                          className="inline-flex items-center gap-1 hover:text-white/70"
                        >
                          {col.label}
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-3 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td colSpan={columns.length + 1} className="px-4 py-4">
                          <div className="h-4 bg-white/10 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : calls.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-16 text-center text-white/40">
                        No calls match your filters
                      </td>
                    </tr>
                  ) : (
                    calls.map((call) => (
                      <tr
                        key={call.callId}
                        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className="px-3 py-3 text-white/80 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelected(call)}
                          >
                            {renderCell(call, col.key)}
                          </td>
                        ))}
                        <td className="px-3 py-3 relative">
                          <button
                            type="button"
                            onClick={() => setMenuOpen((id) => (id === call.callId ? null : call.callId))}
                            className="p-2 rounded-lg hover:bg-white/10 text-white/60"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {menuOpen === call.callId && (
                            <div className="absolute right-4 top-10 z-20 w-48 bg-[#12172A] border border-white/10 rounded-xl shadow-xl py-1">
                              <ActionItem
                                icon={Eye}
                                label="View Details"
                                onClick={() => {
                                  setSelected(call)
                                  setMenuOpen(null)
                                }}
                              />
                              <ActionItem
                                icon={Play}
                                label="Play Recording"
                                onClick={() => {
                                  setPlayingId(call.callId)
                                  setMenuOpen(null)
                                }}
                              />
                              <ActionItem
                                icon={Download}
                                label="Download Recording"
                                onClick={() => {
                                  window.open(getRecordingStreamUrl(call.callId, 'proxy'), '_blank')
                                  setMenuOpen(null)
                                }}
                              />
                              <ActionItem
                                icon={Copy}
                                label="Copy Number"
                                onClick={async () => {
                                  await copyText(call.number)
                                  setToast('Number copied')
                                  setMenuOpen(null)
                                }}
                              />
                              <ActionItem
                                icon={Copy}
                                label="Copy Call ID"
                                onClick={async () => {
                                  await copyText(call.callId)
                                  setToast('Call ID copied')
                                  setMenuOpen(null)
                                }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {playingId && (
              <div className="px-4 py-3 border-t border-white/10 flex items-center gap-3">
                <Headphones className="w-4 h-4 text-purple-400" />
                <CallAudioPlayer callId={playingId} />
                <button
                  className="text-xs text-white/40 hover:text-white ml-auto"
                  onClick={() => setPlayingId(null)}
                >
                  Close player
                </button>
              </div>
            )}

            <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-sm text-white/50">
              <span>
                {total} call{total === 1 ? '' : 's'} · Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-2 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="p-2 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <CallDetailsDrawer call={selected} onClose={() => setSelected(null)} />
      {(error || toast) && (
        <ErrorToast
          message={error || toast || ''}
          onClose={() => {
            setError(null)
            setToast(null)
          }}
        />
      )}
    </div>
  )
}

function ActionItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: any
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5 text-left"
    >
      <Icon className="w-3.5 h-3.5 text-white/40" />
      {label}
    </button>
  )
}
