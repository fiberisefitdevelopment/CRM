'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Disc3,
  Headphones,
  Link2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  TrendingUp,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { CallDetailsDrawer } from '@/components/customer-service/CallDetailsDrawer'
import { CallStatusBadge, boolBadge } from '@/components/customer-service/CallStatusBadge'
import { ErrorToast } from '@/components/ErrorToast'
import { CsHeroMetric } from '@/components/customer-service/dashboard/CsMetricStrip'
import { CsMiniStat } from '@/components/customer-service/dashboard/CsMetricStrip'
import {
  AvgDurationTrend,
  CallVolumeAreaChart,
  ChartPanel,
  DirectionDonut,
  DurationHistogram,
  HourlyBarChart,
  OutcomeDonut,
  TopAgentsChart,
  type ChartPoint,
} from '@/components/customer-service/dashboard/CsDashboardCharts'
import {
  CallData,
  CallSummary,
  dateRangeToIso,
  defaultRangeDays,
  fetchDashboard,
  formatDateTime,
  formatDuration,
} from '@/lib/customerServiceApi'

type DashboardCharts = {
  callsPerDay: ChartPoint[]
  answeredVsMissed: ChartPoint[]
  inboundVsOutbound: ChartPoint[]
  averageDurationTrend: ChartPoint[]
  topUsers: ChartPoint[]
  hourlyDistribution: ChartPoint[]
  durationHistogram: ChartPoint[]
}

function applyPresetDays(days: number, setFrom: (v: string) => void, setTo: (v: string) => void) {
  const range = defaultRangeDays(days)
  setFrom(range.fromDate)
  setTo(range.toDate)
}

export default function CustomerServiceDashboardPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CallSummary | null>(null)
  const [recentCalls, setRecentCalls] = useState<CallData[]>([])
  const [charts, setCharts] = useState<DashboardCharts | null>(null)
  const [answerRate, setAnswerRate] = useState(0)
  const [selected, setSelected] = useState<CallData | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      const data = await fetchDashboard(from, to)
      setSummary(data.summary)
      setRecentCalls(Array.isArray(data.recentCalls) ? data.recentCalls : [])
      setCharts((data.charts as DashboardCharts) || null)
      setAnswerRate(Number((data as any).kpis?.answeredPct ?? 0))
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => {
    load()
  }, [load])

  const recordingRate = useMemo(() => {
    if (!summary?.totalCalls) return 0
    return Math.round(((summary.totalRecordings || 0) / summary.totalCalls) * 100)
  }, [summary])

  const datePresets = (
    <div className="flex flex-wrap gap-1.5">
      {[
        { label: '7 days', days: 7 },
        { label: '30 days', days: 30 },
        { label: '90 days', days: 90 },
      ].map(({ label, days }) => (
        <button
          key={days}
          type="button"
          onClick={() => applyPresetDays(days, setFromDate, setToDate)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:bg-purple-500/10"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-[1400px] mx-auto mt-20 space-y-6">
          <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <h1
                className="text-2xl lg:text-3xl font-extrabold tracking-tight flex items-center gap-3"
                style={{ color: 'var(--foreground)' }}
              >
                <span className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/25 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-purple-500" />
                </span>
                Customer Service
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                Call volume, outcomes, and team performance
              </p>
            </div>
            {!loading && summary && (
              <div
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
              >
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                {summary.totalCalls.toLocaleString('en-IN')} calls · {answerRate}% answered ·{' '}
                {recordingRate}% recorded
              </div>
            )}
          </header>

          <SubNav />

          <DateRangeBar
            fromDate={fromDate}
            toDate={toDate}
            onFromChange={setFromDate}
            onToChange={setToDate}
            onRefresh={load}
            loading={loading}
            rightSlot={datePresets}
          />

          {loading ? (
            <DashboardSkeleton />
          ) : (
            <>
              {/* Hero metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                <CsHeroMetric
                  label="Total calls"
                  value={(summary?.totalCalls ?? 0).toLocaleString('en-IN')}
                  hint={`${summary?.inboundCalls ?? 0} inbound · ${summary?.outboundCalls ?? 0} outbound`}
                  accent="#7c3aed"
                />
                <CsHeroMetric
                  label="Answered"
                  value={(summary?.answeredCalls ?? 0).toLocaleString('en-IN')}
                  hint={`${answerRate}% answer rate`}
                  accent="#10b981"
                />
                <CsHeroMetric
                  label="Missed"
                  value={(summary?.missedCalls ?? 0).toLocaleString('en-IN')}
                  hint={`${summary?.totalCalls ? 100 - answerRate : 0}% missed`}
                  accent="#f43f5e"
                />
                <CsHeroMetric
                  label="Avg duration"
                  value={formatDuration(summary?.averageCallDuration ?? 0)}
                  hint={`${summary?.totalRecordings ?? 0} recordings (${recordingRate}%)`}
                  accent="#14b8a6"
                />
              </div>

              {/* Secondary strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <CsMiniStat icon={PhoneIncoming} label="Inbound" value={summary?.inboundCalls ?? 0} color="#3b82f6" />
                <CsMiniStat icon={PhoneOutgoing} label="Outbound" value={summary?.outboundCalls ?? 0} color="#8b5cf6" />
                <CsMiniStat icon={Link2} label="Integrated" value={summary?.integratedCalls ?? 0} color="#f59e0b" />
                <CsMiniStat icon={Disc3} label="Recordings" value={summary?.totalRecordings ?? 0} color="#06b6d4" />
              </div>

              {/* Main volume chart */}
              <ChartPanel title="Call volume" subtitle="Daily calls in selected range">
                <CallVolumeAreaChart data={charts?.callsPerDay || []} />
              </ChartPanel>

              {/* Donuts + duration */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <ChartPanel title="Call outcomes" subtitle="Answered vs missed">
                  <OutcomeDonut data={charts?.answeredVsMissed || []} answerRate={answerRate} />
                </ChartPanel>
                <ChartPanel title="Call direction" subtitle="Inbound vs outbound mix">
                  <DirectionDonut data={charts?.inboundVsOutbound || []} />
                </ChartPanel>
                <ChartPanel title="Call length" subtitle="How long conversations run">
                  <DurationHistogram data={charts?.durationHistogram || []} />
                </ChartPanel>
              </div>

              {/* Hourly + agents + duration trend */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7">
                  <ChartPanel title="Calls by hour" subtitle="UTC hour — spot peak calling times">
                    <HourlyBarChart data={charts?.hourlyDistribution || []} />
                  </ChartPanel>
                </div>
                <div className="lg:col-span-5 space-y-4">
                  <ChartPanel title="Top agents" subtitle="Most active care executives">
                    <TopAgentsChart data={charts?.topUsers || []} />
                  </ChartPanel>
                  <ChartPanel title="Avg duration trend" subtitle="Daily average talk time">
                    <AvgDurationTrend data={charts?.averageDurationTrend || []} />
                  </ChartPanel>
                </div>
              </div>

              {/* Recent calls */}
              <section
                className="crm-card rounded-2xl border overflow-hidden"
                style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
              >
                <div
                  className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                      Recent calls
                    </h3>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                      Latest 20 — click a row for details & recording
                    </p>
                  </div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                  >
                    Live from device counters
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="text-left text-[10px] uppercase tracking-wider border-b"
                        style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                      >
                        <th className="px-4 py-3 font-bold">Customer</th>
                        <th className="px-4 py-3 font-bold">Agent</th>
                        <th className="px-4 py-3 font-bold">Time</th>
                        <th className="px-4 py-3 font-bold">Duration</th>
                        <th className="px-4 py-3 font-bold">Status</th>
                        <th className="px-4 py-3 font-bold">Direction</th>
                        <th className="px-4 py-3 font-bold">Recording</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCalls.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-16 text-center" style={{ color: 'var(--foreground-muted)' }}>
                            <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No calls in this date range
                          </td>
                        </tr>
                      ) : (
                        recentCalls.map((call) => {
                          const answered = boolBadge(call.answered, 'Answered', 'Missed')
                          const direction = boolBadge(call.inbound, 'Inbound', 'Outbound')
                          return (
                            <tr
                              key={call.callId}
                              className="border-b cursor-pointer transition-colors hover:bg-purple-500/[0.04]"
                              style={{ borderColor: 'var(--border)' }}
                              onClick={() => setSelected(call)}
                            >
                              <td className="px-4 py-3">
                                <p className="font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
                                  {call.formattedNumber || call.number}
                                </p>
                                {call.customerName && (
                                  <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                    {call.customerName}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3" style={{ color: 'var(--foreground-muted)' }}>
                                {call.userName || call.userEmail || '—'}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--foreground-muted)' }}>
                                {formatDateTime(call.startTime || call.createdAt)}
                              </td>
                              <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--foreground)' }}>
                                {formatDuration(call.duration)}
                              </td>
                              <td className="px-4 py-3">
                                <CallStatusBadge label={answered.label} variant={answered.variant} />
                              </td>
                              <td className="px-4 py-3">
                                <CallStatusBadge label={direction.label} variant={direction.variant} />
                              </td>
                              <td className="px-4 py-3">
                                {call.recUrl ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                                    <Disc3 className="w-3 h-3" /> Available
                                  </span>
                                ) : (
                                  <span className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <CallDetailsDrawer call={selected} onClose={() => setSelected(null)} />
      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--card)' }} />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl border" style={{ borderColor: 'var(--border)' }} />
        ))}
      </div>
      <div className="h-80 rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--card)' }} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-72 rounded-2xl border" style={{ borderColor: 'var(--border)', background: 'var(--card)' }} />
        ))}
      </div>
    </div>
  )
}
