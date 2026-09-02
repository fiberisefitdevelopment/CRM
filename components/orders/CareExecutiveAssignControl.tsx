'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { assignCareOrderExecutive } from '@/lib/careTasksApi'
import type { CareOrderAssignmentEntry } from '@/src/services/careAssignmentStore'
import {
  FALLBACK_CARE_EXECUTIVES,
  careExecutiveDisplayName,
} from '@/src/services/careTasks/executiveConfig'

type ExecutiveOption = { userId: string; email: string; name: string }

const DEFAULT_EXECUTIVES: ExecutiveOption[] = FALLBACK_CARE_EXECUTIVES.map((e) => ({
  userId: e.userId,
  email: e.email,
  name: e.name,
}))

/** Clickable Order Status control to view / change the care executive. */
export function CareExecutiveAssignControl({
  orderId,
  orderName,
  phone,
  assignment,
  onAssigned,
}: {
  orderId: string | number
  orderName?: string | null
  phone?: string | null
  assignment?: CareOrderAssignmentEntry | null
  onAssigned?: (entry: CareOrderAssignmentEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const currentEmail = String(assignment?.email || '').toLowerCase().trim()
  const currentLabel = assignment?.email
    ? careExecutiveDisplayName(assignment.email, assignment.name || assignment.label)
    : 'Assign'

  const options = DEFAULT_EXECUTIVES.slice()
  if (currentEmail && !options.some((e) => e.email === currentEmail)) {
    options.unshift({
      userId: currentEmail,
      email: currentEmail,
      name: currentLabel,
    })
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])

  const pick = async (email: string) => {
    setOpen(false)
    if (!email || email === currentEmail) return
    const exec = options.find((e) => e.email === email)
    const previous = assignment || null
    const optimistic: CareOrderAssignmentEntry = {
      orderId: String(orderId),
      orderName: orderName || null,
      email,
      name: exec?.name || careExecutiveDisplayName(email),
      label: exec?.name || careExecutiveDisplayName(email),
      updatedAt: new Date().toISOString(),
    }
    onAssigned?.(optimistic)
    setSaving(true)
    setError(null)
    try {
      const next = await assignCareOrderExecutive({
        orderId,
        orderName,
        email,
        phone,
      })
      onAssigned?.({
        orderId: String(next.orderId || orderId),
        orderName: next.orderName || orderName || null,
        email: next.email || email,
        name: next.name || optimistic.name,
        label: next.label || next.name || optimistic.label,
        updatedAt: next.updatedAt,
      })
    } catch (err: any) {
      if (previous) onAssigned?.(previous)
      else onAssigned?.({ ...optimistic, email: '', name: '', label: '' })
      setError(err?.name === 'TimeoutError' ? 'Timed out — try again' : err?.message || 'Could not assign')
    } finally {
      setSaving(false)
    }
  }

  const assigned = Boolean(currentEmail)

  return (
    <span className="relative inline-flex z-30" data-care-assign="1">
      <button
        ref={btnRef}
        type="button"
        data-care-assign="1"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Assign care executive"
        title={
          error
            ? error
            : assigned
              ? `Assigned to ${assignment?.name || currentLabel}. Click to change.`
              : 'Assign a care executive'
        }
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const rect = btnRef.current?.getBoundingClientRect()
          if (rect) {
            setMenuPos({ top: rect.bottom + 4, left: rect.left })
          }
          setOpen((v) => !v)
        }}
        className={`inline-flex items-center gap-0.5 text-[9px] font-bold pl-1.5 pr-1 py-0.5 rounded border leading-none whitespace-nowrap ${
          error
            ? 'bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/35'
            : assigned
              ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30'
              : 'bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/35'
        }`}
      >
        Care: {error ? 'Retry' : currentLabel}
        {saving ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        ) : (
          <ChevronDown className="w-2.5 h-2.5 opacity-70" />
        )}
      </button>
      {open ? (
        <div
          ref={menuRef}
          data-care-assign="1"
          role="listbox"
          className="rounded-lg border shadow-xl py-1 min-w-[10rem]"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 80,
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
          }}
        >
          {options.map((exec) => {
            const selected = exec.email === currentEmail
            return (
              <button
                key={exec.email}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void pick(exec.email)
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-purple-500/10"
                style={{ color: 'var(--foreground)' }}
              >
                {exec.name}
                {selected ? <Check className="w-3 h-3 text-sky-600" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}
