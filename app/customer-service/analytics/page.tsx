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
  BarChart3,
  Clock,
  Link2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Percent,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { DateRangeBar } from '@/components/customer-service/DateRangeBar'
import { StatsCard } from '@/components/whatsapp/StatsCard'
import { ErrorToast } from '@/components/ErrorToast'
import {
  dateRangeToIso,
  defaultRangeDays,
  fetchAnalytics,
  formatDuration,
} from '@/lib/customerServiceApi'

const COLORS = ['#34d399', '#f87171', '#60a5fa', '#a78bfa', '#fbbf24']

const tooltipStyle = {
  backgroundColor: '#12172A',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#fff',
}

export default function CustomerServiceAnalyticsPage() {
  const initial = defaultRangeDays(30)
  const [fromDate, setFromDate] = useState(initial.fromDate)
  const [toDate, setToDate] = useState(initial.toDate)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { from, to } = dateRangeToIso(fromDate, toDate)
      const analytics = await fetchAnalytics(from, to)
      setData(analytics)
    } catch (err: any) {
      setError(err?.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => {
    load()
  }, [load])

  const kpis = data?.kpis

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/30">
                <BarChart3 className="w-5 h-5 text-purple-400" />
              </div>
              Call Analytics
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Trends, ratios, and agent performance from call export data
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
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="bg-card rounded-2xl border border-white/10 h-28 animate-pulse" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-card rounded-2xl border border-white/10 h-72 animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatsCard title="Total Calls" value={kpis?.totalCalls ?? 0} icon={Phone} gradient="purple" />
                <StatsCard
                  title="Answered %"
                  value={`${kpis?.answeredPct ?? 0}%`}
                  icon={Percent}
                  gradient="emerald"
                />
                <StatsCard
                  title="Missed %"
                  value={`${kpis?.missedPct ?? 0}%`}
                  icon={Percent}
                  gradient="red"
                />
                <StatsCard
                  title="Average Duration"
                  value={formatDuration(kpis?.averageCallDuration ?? 0)}
                  icon={Clock}
                  gradient="amber"
                />
                <StatsCard
                  title="Total Inbound"
                  value={kpis?.inboundCalls ?? 0}
                  icon={PhoneIncoming}
                  gradient="blue"
                />
                <StatsCard
                  title="Total Outbound"
                  value={kpis?.outboundCalls ?? 0}
                  icon={PhoneOutgoing}
                  gradient="teal"
                />
                <StatsCard
                  title="Total Integrated"
                  value={kpis?.integratedCalls ?? 0}
                  icon={Link2}
                  gradient="purple"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <ChartCard title="Daily Calls">
                  <LineChartWrap data={data?.callsPerDay || []} color="#a78bfa" />
                </ChartCard>
                <ChartCard title="Hourly Distribution">
                  <BarChartWrap data={data?.hourlyDistribution || []} color="#60a5fa" />
                </ChartCard>
                <ChartCard title="Weekly Trend">
                  <LineChartWrap data={data?.weeklyTrend || []} color="#34d399" />
                </ChartCard>
                <ChartCard title="Monthly Trend">
                  <BarChartWrap data={data?.monthlyTrend || []} color="#fbbf24" />
                </ChartCard>
                <ChartCard title="Answered Ratio">
                  <PieChartWrap data={data?.answeredVsMissed || []} />
                </ChartCard>
                <ChartCard title="Inbound Ratio">
                  <PieChartWrap data={data?.inboundVsOutbound || []} />
                </ChartCard>
                <ChartCard title="Duration Histogram">
                  <BarChartWrap data={data?.durationHistogram || []} color="#a78bfa" />
                </ChartCard>
                <ChartCard title="Top Calling Users">
                  <BarChartWrap data={data?.topUsers || []} color="#667eea" />
                </ChartCard>
              </div>
            </>
          )}
        </div>
      </main>

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-5 border border-white/10">
      <h3 className="text-white font-semibold mb-4">{title}</h3>
      {children}
    </div>
  )
}

function LineChartWrap({ data, color }: { data: any[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="name" stroke="#ffffff40" tick={{ fontSize: 11 }} />
        <YAxis stroke="#ffffff40" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarChartWrap({ data, color }: { data: any[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="name" stroke="#ffffff40" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
        <YAxis stroke="#ffffff40" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" fill={color} radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function PieChartWrap({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} label>
          {data.map((_: any, i: number) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  )
}
