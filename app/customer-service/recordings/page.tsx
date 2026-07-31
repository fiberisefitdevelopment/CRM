'use client'

import { useCallback, useEffect, useState } from 'react'
import { Headphones, Search } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { CallDetailsDrawer } from '@/components/customer-service/CallDetailsDrawer'
import { CallAudioPlayer } from '@/components/customer-service/CallAudioPlayer'
import { ErrorToast } from '@/components/ErrorToast'
import {
  CallData,
  dateRangeToIso,
  defaultRangeDays,
  fetchCalls,
  formatDateTime,
  formatDuration,
} from '@/lib/customerServiceApi'

export default function RecordingsPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [calls, setCalls] = useState<CallData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CallData | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

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
        page,
        pageSize: 24,
        search: debouncedSearch,
        hasRecording: true,
        sortBy: 'startTime',
        sortDir: 'desc',
      })
      setCalls(data.calls || [])
      setTotalPages(data.totalPages || 1)
    } catch (err: any) {
      setError(err?.message || 'Failed to load recordings')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, page, debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [fromDate, toDate, debouncedSearch])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/30">
                <Headphones className="w-5 h-5 text-purple-400" />
              </div>
              Recordings
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Play and download call recordings
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
              <div className="relative w-full lg:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search recordings…"
                  className="crm-input w-full pl-10 pr-3 py-2.5 text-sm"
                />
              </div>
            }
          />

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-card rounded-2xl border border-white/10 h-44 animate-pulse" />
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="bg-card rounded-2xl border border-white/10 py-20 text-center text-white/40">
              No recordings available for this date range
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {calls.map((call) => (
                  <div
                    key={call.callId}
                    className="bg-card rounded-2xl border border-white/10 p-5 hover:border-purple-500/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <p className="text-white font-semibold">
                          {call.formattedNumber || call.number || 'Unknown'}
                        </p>
                        <p className="text-white/40 text-xs mt-1">{call.userName || '—'}</p>
                      </div>
                      <span className="text-[11px] text-white/40 font-medium">
                        {formatDuration(call.duration)}
                      </span>
                    </div>

                    <p className="text-xs text-white/40 mb-4">
                      {formatDateTime(call.startTime || call.createdAt)}
                    </p>

                    <div className="space-y-3">
                      <CallAudioPlayer callId={call.callId} recUrl={call.recUrl} />
                      <button
                        type="button"
                        onClick={() => setSelected(call)}
                        className="text-xs text-white/40 hover:text-white"
                      >
                        View details
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3 mt-6">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-white/40 text-sm">
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/70 text-sm disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      <CallDetailsDrawer call={selected} onClose={() => setSelected(null)} />
      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  )
}
