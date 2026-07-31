'use client'

import { cn } from '@/lib/utils'

type Variant = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray'

const styles: Record<Variant, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  gray: 'bg-white/10 text-white/60 border-white/15',
}

export function CallStatusBadge({
  label,
  variant = 'gray',
}: {
  label: string
  variant?: Variant
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border',
        styles[variant],
      )}
    >
      {label}
    </span>
  )
}

export function integrationStatusVariant(status?: string): Variant {
  const s = (status || '').toUpperCase()
  if (s === 'SUCCESS') return 'green'
  if (s === 'FAILED') return 'red'
  if (s === 'PENDING') return 'amber'
  if (s === 'RETRY') return 'blue'
  return 'gray'
}

export function boolBadge(value: boolean, trueLabel: string, falseLabel: string) {
  return {
    label: value ? trueLabel : falseLabel,
    variant: (value ? 'green' : 'red') as Variant,
  }
}
