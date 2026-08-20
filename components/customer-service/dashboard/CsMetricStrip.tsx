'use client'

import type { LucideIcon } from 'lucide-react'

export function CsHeroMetric({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string | number
  hint?: string
  accent: string
}) {
  return (
    <div
      className="rounded-2xl border p-4 relative overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
    >
      <div
        className="absolute top-0 left-0 w-full h-1"
        style={{ background: accent }}
      />
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
        {label}
      </p>
      <p className="text-2xl lg:text-3xl font-extrabold tabular-nums mt-1" style={{ color: 'var(--foreground)' }}>
        {value}
      </p>
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--foreground-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function CsMiniStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  color: string
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: 'var(--foreground-muted)' }}>
          {label}
        </p>
        <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--foreground)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
