'use client'

import { Calendar, RefreshCw } from 'lucide-react'

interface DateRangeBarProps {
  fromDate: string
  toDate: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onRefresh?: () => void
  loading?: boolean
  rightSlot?: React.ReactNode
}

export function DateRangeBar({
  fromDate,
  toDate,
  onFromChange,
  onToChange,
  onRefresh,
  loading,
  rightSlot,
}: DateRangeBarProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
            From
          </label>
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onFromChange(e.target.value)}
              className="crm-input pl-9 pr-3 py-2.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
            To
          </label>
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => onToChange(e.target.value)}
              className="crm-input pl-9 pr-3 py-2.5 text-sm"
            />
          </div>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>
      {rightSlot}
    </div>
  )
}
