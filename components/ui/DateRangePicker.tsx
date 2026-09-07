'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toIstDateKey } from '@/src/utils/orderTimeline'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type MenuPos = { top?: number; bottom?: number; left: number; width: number }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toKey(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function shiftKey(key: string, days: number) {
  const parsed = parseKey(key)
  if (!parsed) return key
  const dt = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days))
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function todayIst() {
  return toIstDateKey(new Date().toISOString())
}

function monthStart(key: string) {
  const parsed = parseKey(key)
  if (!parsed) return key
  return toKey(parsed.y, parsed.m, 1)
}

function formatDay(key: string) {
  const parsed = parseKey(key)
  if (!parsed) return key
  return `${parsed.d} ${MONTHS[parsed.m - 1]}`
}

function formatRangeLabel(start: string, end: string) {
  if (!start && !end) return 'All dates'
  if (start && !end) return `${formatDay(start)} → …`
  if (!start && end) return `… → ${formatDay(end)}`
  const s = parseKey(start)
  const e = parseKey(end)
  if (!s || !e) return `${start} – ${end}`
  if (start === end) return `${s.d} ${MONTHS[s.m - 1]} ${s.y}`
  if (s.y === e.y && s.m === e.m) return `${s.d}–${e.d} ${MONTHS[s.m - 1]} ${s.y}`
  if (s.y === e.y) return `${s.d} ${MONTHS[s.m - 1]} – ${e.d} ${MONTHS[e.m - 1]} ${s.y}`
  return `${s.d} ${MONTHS[s.m - 1]} ${s.y} – ${e.d} ${MONTHS[e.m - 1]} ${e.y}`
}

function ordered(a: string, b: string) {
  return a <= b ? [a, b] : [b, a]
}

function buildCells(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysThis = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const daysPrev = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  const cells: { key: string; day: number; outside: boolean }[] = []

  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = daysPrev - i
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    cells.push({ key: toKey(prevYear, prevMonth, d), day: d, outside: true })
  }
  for (let d = 1; d <= daysThis; d++) {
    cells.push({ key: toKey(year, month, d), day: d, outside: false })
  }
  let next = 1
  while (cells.length % 7 !== 0) {
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    cells.push({ key: toKey(nextYear, nextMonth, next), day: next, outside: true })
    next += 1
  }
  return cells
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  className,
}: {
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const [view, setView] = useState(() => parseKey(startDate) || parseKey(todayIst()) || { y: 2026, m: 1, d: 1 })
  const [draftStart, setDraftStart] = useState(startDate)
  const [draftEnd, setDraftEnd] = useState(endDate)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const today = todayIst()

  const cells = useMemo(() => buildCells(view.y, view.m), [view.y, view.m])

  const previewEnd = !draftEnd && draftStart && hoverKey ? hoverKey : draftEnd
  const [rangeStart, rangeEnd] = draftStart && previewEnd ? ordered(draftStart, previewEnd) : ['', '']

  const placeMenu = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const width = Math.min(328, window.innerWidth - 16)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const openUp = spaceBelow < 360 && rect.top > spaceBelow
    let left = rect.right - width
    if (left < 8) left = 8
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width)
    setPos(
      openUp
        ? { bottom: window.innerHeight - rect.top + 4, left, width }
        : { top: rect.bottom + 4, left, width },
    )
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    placeMenu()
  }, [open, placeMenu])

  useEffect(() => {
    if (!open) return
    const onWin = () => placeMenu()
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      placeMenu()
    }
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, placeMenu])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openPicker = () => {
    const anchor = parseKey(startDate) || parseKey(today)
    if (anchor) setView(anchor)
    setDraftStart(startDate)
    setDraftEnd(endDate)
    setHoverKey(null)
    setOpen((v) => !v)
  }

  const commit = (start: string, end: string) => {
    const [from, to] = start && end ? ordered(start, end) : [start, end]
    onChange(from, to)
    setDraftStart(from)
    setDraftEnd(to)
    setOpen(false)
    btnRef.current?.focus()
  }

  const pickDay = (key: string) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(key)
      setDraftEnd('')
      setHoverKey(null)
      return
    }
    commit(draftStart, key)
  }

  const shiftMonth = (delta: number) => {
    setView((cur) => {
      const dt = new Date(Date.UTC(cur.y, cur.m - 1 + delta, 1))
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: 1 }
    })
  }

  const applyPreset = (start: string, end: string) => {
    commit(start, end)
  }

  const presets = [
    { label: 'Last 7 days', start: shiftKey(today, -6), end: today },
    { label: 'Last 30 days', start: shiftKey(today, -29), end: today },
    { label: 'This month', start: monthStart(today), end: today },
    { label: 'All dates', start: '', end: '' },
  ]

  const hint = !draftStart
    ? 'Select start date'
    : !draftEnd
      ? 'Select end date'
      : formatRangeLabel(draftStart, draftEnd)

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Date range"
        onClick={openPicker}
        className={cn(
          'w-full flex items-center gap-1.5 pl-2.5 pr-2 py-2 rounded-lg border text-xs text-left transition-colors',
          'focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/15',
          open && 'border-purple-500/50 ring-2 ring-purple-500/15',
        )}
        style={{
          backgroundColor: 'var(--background)',
          borderColor: open ? undefined : 'var(--border)',
          color: 'var(--foreground)',
        }}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--foreground-muted)' }} />
        <span className="flex-1 min-w-0 truncate font-medium">{formatRangeLabel(startDate, endDate)}</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          style={{ color: 'var(--foreground-muted)' }}
        />
      </button>

      {open && pos ? (
            <div
              ref={menuRef}
              role="dialog"
              aria-label="Choose date range"
              className="rounded-xl border shadow-xl overflow-hidden p-3"
              style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                zIndex: 80,
                backgroundColor: 'var(--card)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex flex-wrap gap-1 mb-3">
                {presets.map((preset) => {
                  const active = startDate === preset.start && endDate === preset.end
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset.start, preset.end)}
                      className={cn(
                        'px-2 py-1 rounded-md border text-[10px] font-semibold transition-colors',
                        active
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'hover:bg-purple-500/10 hover:border-purple-400/40',
                      )}
                      style={active ? undefined : { borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="p-1 rounded-md hover:bg-purple-500/10"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} />
                </button>
                <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  {MONTHS[view.m - 1]} {view.y}
                </p>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="p-1 rounded-md hover:bg-purple-500/10"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" style={{ color: 'var(--foreground-muted)' }} />
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    className="h-7 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7" onMouseLeave={() => setHoverKey(null)}>
                {cells.map((cell) => {
                  const isStart = Boolean(rangeStart && cell.key === rangeStart)
                  const isEnd = Boolean(rangeEnd && cell.key === rangeEnd)
                  const isEdge = isStart || isEnd
                  const inRange =
                    Boolean(rangeStart && rangeEnd && cell.key > rangeStart && cell.key < rangeEnd)
                  const isToday = cell.key === today
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      onMouseEnter={() => setHoverKey(cell.key)}
                      onClick={() => pickDay(cell.key)}
                      className={cn(
                        'relative h-9 text-xs font-medium transition-colors',
                        cell.outside && 'opacity-40',
                        inRange && 'bg-purple-500/10',
                        isStart && rangeEnd && 'rounded-l-full bg-purple-500/10',
                        isEnd && rangeStart && rangeStart !== rangeEnd && 'rounded-r-full bg-purple-500/10',
                      )}
                      style={{ color: isEdge ? undefined : 'var(--foreground)' }}
                    >
                      <span
                        className={cn(
                          'inline-flex w-8 h-8 items-center justify-center rounded-full',
                          isEdge && 'bg-purple-600 text-white',
                          !isEdge && isToday && 'ring-1 ring-purple-400',
                          !isEdge && 'hover:bg-purple-500/15',
                        )}
                      >
                        {cell.day}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="mt-2 text-[11px] text-center font-medium" style={{ color: 'var(--foreground-muted)' }}>
                {hint}
              </p>
            </div>
      ) : null}
    </div>
  )
}
