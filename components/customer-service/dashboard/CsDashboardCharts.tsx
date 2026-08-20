'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDuration } from '@/lib/customerServiceApi'

export type ChartPoint = { name: string; value: number }

const COLORS = {
  answered: '#10b981',
  missed: '#f43f5e',
  inbound: '#3b82f6',
  outbound: '#8b5cf6',
  purple: '#7c3aed',
  teal: '#14b8a6',
  amber: '#f59e0b',
  slate: '#94a3b8',
}

const DONUT_PALETTE = [COLORS.answered, COLORS.missed, COLORS.inbound, COLORS.outbound, COLORS.teal, COLORS.amber]

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--border)',
        color: 'var(--foreground)',
      }}
    >
      {label && (
        <p className="font-semibold mb-1" style={{ color: 'var(--foreground-muted)' }}>
          {label}
        </p>
      )}
      {payload.map((p: any) => (
        <p key={p.name} className="font-bold tabular-nums">
          <span style={{ color: p.color || p.fill }}>{p.name}: </span>
          {p.name?.toLowerCase().includes('duration') || p.dataKey === 'value' && String(p.name).includes('Avg')
            ? formatDuration(Number(p.value))
            : p.value}
        </p>
      ))}
    </div>
  )
}

export function ChartPanel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`crm-card rounded-2xl border p-5 ${className}`}
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <div className="mb-4">
        <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
          {title}
        </h3>
        {subtitle && (
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function DonutChart({
  data,
  colors,
  centerLabel,
  centerValue,
}: {
  data: ChartPoint[]
  colors: string[]
  centerLabel: string
  centerValue: string | number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No data in range
      </div>
    )
  }

  return (
    <div className="relative h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={88}
            paddingAngle={3}
            stroke="none"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-2xl font-extrabold tabular-nums" style={{ color: 'var(--foreground)' }}>
          {centerValue}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
          {centerLabel}
        </p>
      </div>
    </div>
  )
}

function DonutLegend({ data, colors }: { data: ChartPoint[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: colors[i % colors.length] }}
          />
          <span className="text-[11px] truncate flex-1" style={{ color: 'var(--foreground-muted)' }}>
            {d.name}
          </span>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--foreground)' }}>
            {d.value} ({Math.round((d.value / total) * 100)}%)
          </span>
        </div>
      ))}
    </div>
  )
}

export function CallVolumeAreaChart({ data }: { data: ChartPoint[] }) {
  if (!data.length) {
    return (
      <div className="h-[280px] flex items-center justify-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No calls in this period
      </div>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.name).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="callVolumeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.purple} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLORS.purple} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          name="Calls"
          stroke={COLORS.purple}
          strokeWidth={2.5}
          fill="url(#callVolumeGrad)"
          dot={false}
          activeDot={{ r: 4, fill: COLORS.purple, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function OutcomeDonut({ data, answerRate }: { data: ChartPoint[]; answerRate: number }) {
  return (
    <>
      <DonutChart
        data={data}
        colors={[COLORS.answered, COLORS.missed]}
        centerLabel="Answer rate"
        centerValue={`${answerRate}%`}
      />
      <DonutLegend data={data} colors={[COLORS.answered, COLORS.missed]} />
    </>
  )
}

export function DirectionDonut({ data }: { data: ChartPoint[] }) {
  const outbound = data.find((d) => d.name === 'Outbound')?.value ?? 0
  const total = data.reduce((s, d) => s + d.value, 0)
  const outboundPct = total ? Math.round((outbound / total) * 100) : 0
  return (
    <>
      <DonutChart
        data={data}
        colors={[COLORS.inbound, COLORS.outbound]}
        centerLabel="Outbound"
        centerValue={`${outboundPct}%`}
      />
      <DonutLegend data={data} colors={[COLORS.inbound, COLORS.outbound]} />
    </>
  )
}

export function HourlyBarChart({ data }: { data: ChartPoint[] }) {
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] || { name: '', value: 0 })
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: 'var(--foreground-muted)' }}
            axisLine={false}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="value" name="Calls" radius={[4, 4, 0, 0]} maxBarSize={14}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.name === peak.name ? COLORS.purple : 'var(--border)'}
                fillOpacity={entry.name === peak.name ? 1 : 0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {peak.value > 0 && (
        <p className="text-[11px] mt-2 text-center" style={{ color: 'var(--foreground-muted)' }}>
          Peak hour: <strong style={{ color: 'var(--foreground)' }}>{peak.name}</strong> ({peak.value} calls)
        </p>
      )}
    </>
  )
}

export function DurationHistogram({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="value" name="Calls" fill={COLORS.teal} radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TopAgentsChart({ data }: { data: ChartPoint[] }) {
  if (!data.length) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No agent data
      </div>
    )
  }

  const sorted = [...data].sort((a, b) => a.value - b.value).slice(-8)
  const max = sorted[sorted.length - 1]?.value || 1

  return (
    <div className="space-y-2.5">
      {sorted.map((row, i) => (
        <div key={row.name}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium truncate" style={{ color: 'var(--foreground)' }}>
              {row.name}
            </span>
            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--foreground-muted)' }}>
              {row.value}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(8, (row.value / max) * 100)}%`,
                background: `linear-gradient(90deg, ${COLORS.purple}, ${COLORS.inbound})`,
                opacity: 0.85 + (i / sorted.length) * 0.15,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AvgDurationTrend({ data }: { data: ChartPoint[] }) {
  if (!data.length) {
    return (
      <div className="h-[180px] flex items-center justify-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No duration data
      </div>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.name).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={formatted} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="durGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 9, fill: 'var(--foreground-muted)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}s`}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div
                className="rounded-xl border px-3 py-2 text-xs"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <p style={{ color: 'var(--foreground-muted)' }}>{label}</p>
                <p className="font-bold" style={{ color: 'var(--foreground)' }}>
                  Avg {formatDuration(Number(payload[0].value))}
                </p>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={COLORS.teal}
          strokeWidth={2}
          fill="url(#durGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
