'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Headphones,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Clock,
  Link2,
  Disc3,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { CallDetailsDrawer } from '@/components/customer-service/CallDetailsDrawer'
import { CallStatusBadge, boolBadge } from '@/components/customer-service/CallStatusBadge'
import { StatsCard } from '@/components/whatsapp/StatsCard'
import { ErrorToast } from '@/components/ErrorToast'
import {
  CallData,
  CallSummary,
  dateRangeToIso,
  defaultRangeDays,
  fetchDashboard,
  formatDateTime,
  formatDuration,
} from '@/lib/customerServiceApi'

const PIE_COLORS = ['#34d399', '#f87171', '#60a5fa', '#a78bfa']

export default function CustomerServiceDashboardPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CallSummary | null>(null)
  const [recentCalls, setRecentCalls] = useState<CallData[]>([])
  const [charts, setCharts] = useState<any>(null)
  const [selected, setSelected] = useState<CallData | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      const data = await fetchDashboard(from, to)
      setSummary(data.summary)
      setRecentCalls(Array.isArray(data.recentCalls) ? data.recentCalls : [])
      setCharts(data.charts || null)
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => {
    load()
  }, [load])

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
              Customer Service
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Call history, recordings, and integration analytics
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

          {loading ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-card rounded-2xl p-6 border border-white/10 animate-pulse h-28" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card rounded-2xl border border-white/10 h-72 animate-pulse" />
                <div className="bg-card rounded-2xl border border-white/10 h-72 animate-pulse" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatsCard title="Total Calls" value={summary?.totalCalls ?? 0} icon={Phone} gradient="purple" />
                <StatsCard title="Answered Calls" value={summary?.answeredCalls ?? 0} icon={PhoneIncoming} gradient="emerald" />
                <StatsCard title="Missed Calls" value={summary?.missedCalls ?? 0} icon={PhoneMissed} gradient="red" />
                <StatsCard title="Inbound Calls" value={summary?.inboundCalls ?? 0} icon={PhoneIncoming} gradient="blue" />
                <StatsCard title="Outbound Calls" value={summary?.outboundCalls ?? 0} icon={PhoneOutgoing} gradient="teal" />
                <StatsCard title="Integrated Calls" value={summary?.integratedCalls ?? 0} icon={Link2} gradient="amber" />
                <StatsCard
                  title="Avg Call Duration"
                  value={formatDuration(summary?.averageCallDuration ?? 0)}
                  icon={Clock}
                  gradient="purple"
                />
                <StatsCard title="Total Recordings" value={summary?.totalRecordings ?? 0} icon={Disc3} gradient="blue" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <ChartCard title="Calls Per Day">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={charts?.callsPerDay || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" stroke="#ffffff40" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#ffffff40" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Answered vs Missed">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={charts?.answeredVsMissed || []} dataKey="value" nameKey="name" outerRadius={90} label>
                        {(charts?.answeredVsMissed || []).map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Inbound vs Outbound">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={charts?.inboundVsOutbound || []} dataKey="value" nameKey="name" outerRadius={90} label>
                        {(charts?.inboundVsOutbound || []).map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Average Duration Trend">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={charts?.averageDurationTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" stroke="#ffffff40" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#ffffff40" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Top Users by Calls" className="mb-6">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={charts?.topUsers || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="name" stroke="#ffffff40" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#ffffff40" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" fill="#667eea" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/10">
                  <h3 className="text-white font-bold">Recent Calls</h3>
                  <p className="text-white/40 text-xs mt-0.5">Latest 20 calls in the selected range</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-white/10">
                      <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                        <th className="px-4 py-3 font-bold">Customer Number</th>
                        <th className="px-4 py-3 font-bold">User</th>
                        <th className="px-4 py-3 font-bold">Call Time</th>
                        <th className="px-4 py-3 font-bold">Duration</th>
                        <th className="px-4 py-3 font-bold">Answered</th>
                        <th className="px-4 py-3 font-bold">Direction</th>
                        <th className="px-4 py-3 font-bold">Recording</th>
                        <th className="px-4 py-3 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCalls.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-white/40">
                            No calls found for this date range
                          </td>
                        </tr>
                      ) : (
                        recentCalls.map((call) => {
                          const answered = boolBadge(call.answered, 'Answered', 'Missed')
                          const direction = boolBadge(call.inbound, 'Inbound', 'Outbound')
                          return (
                            <tr
                              key={call.callId}
                              className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                              onClick={() => setSelected(call)}
                            >
                              <td className="px-4 py-3 text-white font-medium">
                                {call.formattedNumber || call.number}
                              </td>
                              <td className="px-4 py-3 text-white/70">{call.userName || '—'}</td>
                              <td className="px-4 py-3 text-white/70">
                                {formatDateTime(call.startTime || call.createdAt)}
                              </td>
                              <td className="px-4 py-3 text-white/70">{formatDuration(call.duration)}</td>
                              <td className="px-4 py-3">
                                <CallStatusBadge label={answered.label} variant={answered.variant} />
                              </td>
                              <td className="px-4 py-3">
                                <CallStatusBadge label={direction.label} variant={direction.variant} />
                              </td>
                              <td className="px-4 py-3 text-white/60">
                                {call.recUrl ? 'Available' : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <CallStatusBadge
                                  label={call.integrated ? 'Integrated' : 'Open'}
                                  variant={call.integrated ? 'purple' : 'gray'}
                                />
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
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

const tooltipStyle = {
  backgroundColor: '#12172A',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
}

function ChartCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-card rounded-2xl p-5 border border-white/10 ${className}`}>
      <h3 className="text-white font-semibold mb-4">{title}</h3>
      {children}
    </div>
  )
}
