'use client'

import { apiFetch } from '@/lib/auth'
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  RefreshCw,
} from 'lucide-react'
import type { RtoByPincodeReport } from '@/src/services/analytics/rtoByPincode'

function localTodayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDaysAgoKey(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtInr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    n,
  )

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

export default function RtoPincodeReportPage() {
  const [startDate, setStartDate] = useState(localDaysAgoKey(29))
  const [endDate, setEndDate] = useState(localTodayKey())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<RtoByPincodeReport | null>(null)
  const [downloading, setDownloading] = useState(false)

  const pagination = report?.pagination
  const totalPincodes = pagination?.total ?? report?.byPincode.length ?? 0
  const totalPages = pagination?.total_pages ?? 1
  const safePage = pagination?.page ?? page
  const pageStart = totalPincodes === 0 ? 0 : (safePage - 1) * (pagination?.per_page ?? pageSize)

  const loadReport = useCallback(
    async (refresh = false, opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true
      try {
        if (silent) setPageLoading(true)
        else setLoading(true)
        setError(null)
        const params = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
          page: String(page),
          per_page: String(pageSize),
        })
        if (refresh) params.set('refresh', 'true')
        const res = await apiFetch(`/api/analytics/rto-by-pincode?${params}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load report')
        if (data.syncing) {
          setError('Orders cache is still syncing. Try Refresh in a moment.')
          setReport(null)
          return
        }
        setReport(data as RtoByPincodeReport)
        if (data.pagination?.page && data.pagination.page !== page) {
          setPage(data.pagination.page)
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load report')
        if (!silent) setReport(null)
      } finally {
        setLoading(false)
        setPageLoading(false)
      }
    },
    [startDate, endDate, page, pageSize],
  )

  useEffect(() => {
    void loadReport(false, { silent: !!report })
  }, [loadReport])

  const downloadSheet = async () => {
    try {
      setDownloading(true)
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        format: 'csv',
      })
      const res = await apiFetch(`/api/analytics/rto-by-pincode?${params}`)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text.slice(0, 200) || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `rto_initiated_by_pincode_${endDate}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e?.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300 min-w-0">
        <div className="max-w-7xl mx-auto mt-20 space-y-5">
            <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl lg:text-2xl font-extrabold flex items-center gap-2 tracking-tight" style={{ color: 'var(--foreground)' }}>
                  <MapPin className="w-5 h-5 text-red-500 shrink-0" />
                  <span className="truncate">RTO initiated — pincode heatmap</span>
                </h1>
                <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--foreground-muted)' }}>
                  Pincodes ranked by RTO initiated and RTO delivered (Shiprocket / Shipway / enriched status).
                  Export opens in Excel or Google Sheets.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2 shrink-0">
                <label className="text-xs font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                  From
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      setPage(1)
                      setReport(null)
                    }}
                    className="mt-1 block px-3 py-2 rounded-xl border text-sm"
                    style={{ borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}
                  />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                  To
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value)
                      setPage(1)
                      setReport(null)
                    }}
                    className="mt-1 block px-3 py-2 rounded-xl border text-sm"
                    style={{ borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadReport(true)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void downloadSheet()}
                  disabled={downloading || !report?.summary.uniquePincodesWithRto}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Download for Google Sheets
                </button>
                <a
                  href="https://sheets.new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  Open blank Google Sheet
                </a>
              </div>
            </div>

            {error && (
              <div
                className="flex items-center gap-2 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-600"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {report && !loading && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'RTO initiated', value: report.summary.totalRtoInitiated, accent: 'text-red-600' },
                    { label: 'RTO delivered', value: report.summary.totalRtoDelivered, accent: 'text-amber-600' },
                    { label: 'Pincodes with RTO', value: report.summary.uniquePincodesWithRto, accent: '' },
                    { label: 'Orders in date range', value: report.summary.totalOrdersInRange, accent: '' },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="crm-card p-4 rounded-2xl"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                        {card.label}
                      </p>
                      <p className={`text-2xl font-extrabold mt-1 ${card.accent}`} style={card.accent ? undefined : { color: 'var(--foreground)' }}>
                        {card.value.toLocaleString('en-IN')}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="crm-card rounded-2xl overflow-hidden">
                  <div
                    className="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                        Top pincodes by RTO (initiated + delivered)
                      </h2>
                    </div>
                    {totalPincodes > 0 && (
                      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                        Showing{' '}
                        <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {pageStart + 1}–{Math.min(pageStart + report.byPincode.length, totalPincodes)}
                        </span>{' '}
                        of{' '}
                        <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {totalPincodes.toLocaleString('en-IN')}
                        </span>{' '}
                        pincodes
                      </p>
                    )}
                  </div>
                  <div className="overflow-x-auto relative">
                    {pageLoading && (
                      <div
                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/5 dark:bg-black/20"
                        aria-busy="true"
                      >
                        <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                          <th className="px-4 py-3">#</th>
                          <th className="px-4 py-3">Pincode</th>
                          <th className="px-4 py-3">City</th>
                          <th className="px-4 py-3">State</th>
                          <th className="px-4 py-3">Zone</th>
                          <th className="px-4 py-3 text-right">RTO initiated</th>
                          <th className="px-4 py-3 text-right">RTO delivered</th>
                          <th className="px-4 py-3 text-right">Total RTO</th>
                          <th className="px-4 py-3 text-right">Orders</th>
                          <th className="px-4 py-3 text-right">RTO %</th>
                          <th className="px-4 py-3 text-right">Initiated value</th>
                          <th className="px-4 py-3 text-right">Delivered value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byPincode.length === 0 ? (
                          <tr>
                            <td colSpan={12} className="px-4 py-8 text-center" style={{ color: 'var(--foreground-muted)' }}>
                              No RTO initiated or delivered orders in this date range.
                            </td>
                          </tr>
                        ) : (
                          report.byPincode.map((row) => (
                            <tr
                              key={row.pincode}
                              className="border-t"
                              style={{ borderColor: 'var(--border)' }}
                            >
                              <td className="px-4 py-3 font-mono text-xs">{row.rank}</td>
                              <td className="px-4 py-3 font-bold">{row.pincode}</td>
                              <td className="px-4 py-3">{row.city}</td>
                              <td className="px-4 py-3">{row.state}</td>
                              <td className="px-4 py-3">{row.zone || '—'}</td>
                              <td className="px-4 py-3 text-right font-bold text-red-600">{row.rtoInitiatedCount}</td>
                              <td className="px-4 py-3 text-right font-bold text-amber-600">{row.rtoDeliveredCount}</td>
                              <td className="px-4 py-3 text-right font-semibold">{row.totalRtoCount}</td>
                              <td className="px-4 py-3 text-right">{row.totalOrdersInPincode}</td>
                              <td className="px-4 py-3 text-right">{row.rtoPct}%</td>
                              <td className="px-4 py-3 text-right">{fmtInr(row.rtoInitiatedValue)}</td>
                              <td className="px-4 py-3 text-right">{fmtInr(row.rtoDeliveredValue)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {totalPincodes > 0 && (
                    <div
                      className="px-4 py-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                        Page{' '}
                        <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {safePage}
                        </span>{' '}
                        of{' '}
                        <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {totalPages}
                        </span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                          Per page
                          <select
                            value={pageSize}
                            onChange={(e) => {
                              setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
                              setPage(1)
                            }}
                            className="px-2 py-1.5 rounded-lg border text-xs"
                            style={{
                              backgroundColor: 'var(--card)',
                              borderColor: 'var(--border)',
                              color: 'var(--foreground)',
                            }}
                          >
                            {PAGE_SIZE_OPTIONS.map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={safePage <= 1 || pageLoading}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40"
                          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={safePage >= totalPages || pageLoading}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40"
                          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        >
                          Next
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {loading && !report && (
              <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            )}
        </div>
      </main>
  )
}
