'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FilterSelectOption = { value: string; label: string }

type MenuPos = { top?: number; bottom?: number; left: number; width: number; maxHeight: number }

export function FilterSelect({
  value,
  onChange,
  options,
  searchable = false,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: FilterSelectOption[]
  searchable?: boolean
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const enableSearch = searchable || options.length > 8

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? options[0],
    [options, value],
  )
  const isActive = Boolean(selected && selected.value !== 'all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])

  const placeMenu = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportPad = 8
    const minWidth = Math.max(rect.width, 176)
    const maxWidth = Math.min(280, window.innerWidth - viewportPad * 2)
    const width = Math.min(Math.max(minWidth, 200), maxWidth)
    const spaceBelow = window.innerHeight - rect.bottom - viewportPad
    const spaceAbove = rect.top - viewportPad
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, Math.min(280, openUp ? spaceAbove - 6 : spaceBelow - 6))
    let left = rect.left
    if (left + width > window.innerWidth - viewportPad) {
      left = Math.max(viewportPad, window.innerWidth - viewportPad - width)
    }
    setPos(
      openUp
        ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight }
        : { top: rect.bottom + 4, left, width, maxHeight },
    )
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    placeMenu()
  }, [open, placeMenu, filtered.length, query])

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

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const idx = Math.max(0, filtered.findIndex((o) => o.value === value))
    setHighlight(idx)
    const t = window.setTimeout(() => (enableSearch ? searchRef.current : menuRef.current)?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery('')
    btnRef.current?.focus()
  }

  const moveHighlight = (delta: number) => {
    if (filtered.length === 0) return
    setHighlight((h) => (h + delta + filtered.length) % filtered.length)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  }

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const opt = filtered[highlight]
      if (opt) select(opt.value)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlight(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlight(Math.max(0, filtered.length - 1))
    }
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'w-full flex items-center gap-1.5 pl-2.5 pr-2 py-2 rounded-lg border text-xs text-left transition-colors',
          'focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/15',
          open && 'border-purple-500/50 ring-2 ring-purple-500/15',
          isActive && !open && 'border-purple-400/40 bg-purple-500/[0.06]',
        )}
        style={{
          backgroundColor: isActive && !open ? undefined : 'var(--background)',
          borderColor: open || isActive ? undefined : 'var(--border)',
          color: 'var(--foreground)',
        }}
      >
        <span className="flex-1 min-w-0 truncate font-medium">{selected?.label ?? 'Select'}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          style={{ color: 'var(--foreground-muted)' }}
        />
      </button>

      {open && pos ? (
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-activedescendant={filtered[highlight] ? `${listId}-opt-${filtered[highlight].value}` : undefined}
              onKeyDown={onMenuKeyDown}
              className="rounded-xl border shadow-xl overflow-hidden"
              style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                zIndex: 80,
                backgroundColor: 'var(--card)',
                borderColor: 'var(--border)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {enableSearch && (
                <div className="p-1.5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="relative">
                    <Search
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                      style={{ color: 'var(--foreground-muted)' }}
                    />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value)
                        setHighlight(0)
                      }}
                      onKeyDown={onMenuKeyDown}
                      placeholder="Search…"
                      className="w-full pl-7 pr-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      style={{
                        backgroundColor: 'var(--background)',
                        color: 'var(--foreground)',
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="overflow-y-auto custom-dropdown-scroll py-1" style={{ maxHeight: pos.maxHeight - (enableSearch ? 44 : 0) }}>
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    No matches
                  </p>
                ) : (
                  filtered.map((opt, idx) => {
                    const active = opt.value === value
                    const hovered = idx === highlight
                    return (
                      <button
                        key={opt.value}
                        id={`${listId}-opt-${opt.value}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-idx={idx}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => select(opt.value)}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium transition-colors',
                          hovered && 'bg-purple-500/10',
                          active && 'text-purple-700 dark:text-purple-300',
                        )}
                        style={{ color: active ? undefined : 'var(--foreground)' }}
                      >
                        <span className="min-w-0 truncate">{opt.label}</span>
                        {active ? <Check className="w-3.5 h-3.5 shrink-0 text-purple-600" /> : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
      ) : null}
    </div>
  )
}
