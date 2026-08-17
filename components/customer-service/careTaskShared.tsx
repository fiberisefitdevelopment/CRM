'use client'

import { CheckCircle2, Clock } from 'lucide-react'
import type { CareTask } from '@/lib/careTasksApi'
import { parseFlexibleDate, type TimelineStep } from '@/src/utils/orderTimeline'

export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtWhen(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value) || new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDay(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value) || new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function badge(tone: 'red' | 'amber' | 'emerald' | 'blue' | 'purple' | 'muted' | 'neutral') {
  const map = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/25',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25',
    purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25',
    muted: 'bg-black/5 dark:bg-white/5 text-[var(--foreground-muted)] border-[var(--border)]',
    neutral: 'bg-black/5 dark:bg-white/5 text-[var(--foreground-muted)] border-[var(--border)]',
  }
  return `text-[10px] font-bold px-2 py-0.5 rounded border ${map[tone]}`
}

export function isTaskOverdue(task: CareTask) {
  if (task.status !== 'pending' && task.status !== 'rescheduled') return false
  return Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() < Date.now())
}

export function statusBadge(task: CareTask) {
  if (task.status === 'completed') return { label: 'Done', tone: 'emerald' as const }
  if (task.status === 'not_interested') return { label: 'Not interested', tone: 'muted' as const }
  if (task.status === 'escalated') return { label: 'Escalated', tone: 'red' as const }
  if (task.status === 'unreachable') return { label: 'Unreachable', tone: 'amber' as const }
  if (isTaskOverdue(task)) return { label: 'Overdue', tone: 'red' as const }
  if (task.status === 'rescheduled') return { label: 'Call after', tone: 'blue' as const }
  return { label: 'Pending', tone: 'amber' as const }
}

export function escalationReason(task: CareTask): string {
  return String(task.remarks || task.notes?.[0]?.text || '').trim()
}

export function careOrderWorkspaceHref(
  orderId: string | number,
  taskId?: string | null,
  from?: string | null,
) {
  const base = `/customer-service/care-tasks/order/${encodeURIComponent(String(orderId))}`
  const qs = new URLSearchParams()
  if (taskId) qs.set('task', String(taskId))
  if (from) qs.set('from', String(from))
  const q = qs.toString()
  return q ? `${base}?${q}` : base
}

export function careWorkspaceBackLink(from?: string | null): { href: string; label: string } {
  switch (String(from || '').trim()) {
    case 'delivered-upsell':
      return {
        href: '/customer-service/delivered-orders?tab=upsell',
        label: 'Back to upsell tasks',
      }
    case 'delivered':
      return {
        href: '/customer-service/delivered-orders',
        label: 'Back to delivered orders',
      }
    default:
      return {
        href: '/customer-service/care-tasks',
        label: 'Back to tasks',
      }
  }
}

export function openCareOrderWorkspace(
  orderId: string | number,
  taskId?: string | null,
  from?: string | null,
) {
  const href = careOrderWorkspaceHref(orderId, taskId, from)
  // Do not pass a features string — Safari often silently blocks
  // window.open(url, '_blank', 'noopener,noreferrer').
  const opened = window.open(href, '_blank')
  if (opened) {
    try {
      opened.opener = null
    } catch {
      /* ignore */
    }
    return
  }
  // Popup blocked — fall back to a real <a> click (still user-gesture adjacent).
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export type OrderContext = {
  order: any
  operational: any
  parent: any
  clones: any[]
  delivered: boolean
  statusLabel: string
  timeline: TimelineStep[]
  state?: string | null
  city?: string | null
  pincode?: string | null
  etd?: string | null
  customer?: {
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    address1?: string | null
    address2?: string | null
    city?: string | null
    province?: string | null
    zip?: string | null
    country?: string | null
  } | null
  repeatedCustomer?: boolean
  samePhoneOrderCount?: number
  samePhoneOrders?: Array<{
    id: string | number
    name: string
    created_at: string | null
    total_price: string
    currency: string
    financial_status?: string | null
    fulfillment_status?: string | null
    cancelled_at?: string | null
    statusLabel?: string
    productTitle?: string | null
    isCurrent?: boolean
  }>
}

export function TimelineRail({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <ol className="flex items-start min-w-min gap-0">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1
          return (
            <li key={step.key} className="flex items-start shrink-0">
              <div className="w-[7.5rem] flex flex-col items-center text-center px-1">
                <div
                  className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                    step.completed
                      ? badge(step.tone === 'neutral' ? 'muted' : step.tone)
                      : 'bg-[var(--card)] border-[var(--border)] text-[var(--foreground-muted)]'
                  }`}
                >
                  {step.completed ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                </div>
                <p
                  className="mt-2 text-[11px] font-semibold leading-tight line-clamp-2"
                  style={{ color: 'var(--foreground)' }}
                >
                  {step.label}
                </p>
                {step.current && (
                  <span className="mt-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-600 border-purple-500/20">
                    Current
                  </span>
                )}
                <p
                  className="mt-1 text-[10px] leading-snug line-clamp-2"
                  style={{ color: 'var(--foreground-muted)' }}
                  title={step.description}
                >
                  {step.description}
                </p>
                <p className="mt-0.5 text-[10px]" style={{ color: 'var(--foreground-muted)' }}>
                  {step.timestamp ? fmtDay(step.timestamp) : '—'}
                </p>
              </div>
              {!isLast && (
                <div
                  className="w-6 h-0.5 mt-4 shrink-0 rounded-full"
                  style={{
                    background: step.completed ? 'rgb(168 85 247 / 0.55)' : 'var(--border)',
                  }}
                />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export type CareActivityItem = {
  id: string
  at: string
  title: string
  detail?: string
  by?: string
}

function shortActor(value?: string | null): string | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  if (raw.includes('@')) {
    const local = raw.split('@')[0] || raw
    const first = local.split(/[._-]/)[0] || local
    return first.charAt(0).toUpperCase() + first.slice(1)
  }
  return raw
}

function taskName(task: CareTask): string {
  return String(task.taskLabel || task.taskType || 'Care task').trim()
}

/** Human-readable activity for every care action on an order (all journey steps). */
export function buildCareOrderActivity(
  tasks: CareTask[],
  logs: Array<{
    id: string
    action: string
    taskId?: string | null
    details?: Record<string, unknown>
    createdAt?: string | null
  }> = [],
): CareActivityItem[] {
  const items: CareActivityItem[] = []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  for (const t of tasks) {
    const name = taskName(t)

    if (t.createdAt) {
      items.push({
        id: `${t.id}:created`,
        at: t.createdAt,
        title: `${name} created`,
      })
    }

    if (t.scheduledAt && t.scheduleDay !== -2) {
      items.push({
        id: `${t.id}:scheduled`,
        at: t.scheduledAt,
        title: `${name} scheduled`,
        detail:
          t.scheduleDay < 0
            ? 'COD confirmation window'
            : t.scheduleDay === 0
              ? 'On delivery / intro'
              : `Day ${t.scheduleDay} after delivery`,
      })
    }

    if (t.completedAt || t.status === 'completed') {
      const at = t.completedAt || t.updatedAt || t.createdAt
      if (at) {
        const outcome = String(t.outcome || '').trim()
        const isConfirm = /confirmed by /i.test(outcome) || t.careOrderTag === 'care_confirmed'
        const isCancel = /cancel requested by /i.test(outcome) || t.careOrderTag === 'care_cancelled'
        items.push({
          id: `${t.id}:completed`,
          at,
          title: isConfirm
            ? `${name} confirmed`
            : isCancel
              ? `${name} cancel tagged`
              : `${name} completed`,
          detail: outcome || t.customerResponse || t.remarks || undefined,
          by:
            shortActor(outcome.match(/by\s+(.+)$/i)?.[1]) ||
            shortActor(t.assignedTo?.name) ||
            shortActor(t.assignedTo?.email),
        })
      }
    }

    if (t.status === 'not_interested') {
      const at = t.updatedAt || t.completedAt || t.createdAt
      if (at) {
        items.push({
          id: `${t.id}:not_interested`,
          at,
          title: `${name} marked not interested`,
          detail: t.remarks || t.outcome || undefined,
          by: shortActor(t.assignedTo?.name) || shortActor(t.assignedTo?.email),
        })
      }
    }

    if (t.lastUnreachableAt) {
      items.push({
        id: `${t.id}:unreachable`,
        at: t.lastUnreachableAt,
        title: `${name} marked unreachable`,
        detail: t.remarks || undefined,
        by: shortActor(t.assignedTo?.name) || shortActor(t.assignedTo?.email),
      })
    }

    if (t.rescheduledAt || (t.status === 'rescheduled' && t.scheduledAt)) {
      const at = t.rescheduledAt || t.updatedAt || t.scheduledAt
      if (at) {
        items.push({
          id: `${t.id}:reschedule`,
          at,
          title: `${name} call after set`,
          detail: t.scheduledAt ? `Call after ${fmtWhen(t.scheduledAt)}` : t.remarks || undefined,
          by: shortActor(t.assignedTo?.name) || shortActor(t.assignedTo?.email),
        })
      }
    }

    if (t.status === 'escalated') {
      const at = t.updatedAt || t.createdAt
      if (at) {
        const to =
          t.escalatedTo?.name ||
          t.escalatedTo?.email ||
          t.assignedTo?.name ||
          t.assignedTo?.email
        items.push({
          id: `${t.id}:escalated`,
          at,
          title: `${name} escalated${to ? ` to ${shortActor(to) || to}` : ''}`,
          detail: escalationReason(t) || undefined,
        })
      }
    }

    for (const n of t.notes || []) {
      items.push({
        id: `${t.id}:note:${n.id}`,
        at: n.createdAt,
        title: `Note on ${name}`,
        detail: n.text,
        by: shortActor(n.authorName) || shortActor(n.authorEmail),
      })
    }

    for (const c of t.calls || []) {
      const at = c.attachedAt || c.startTime || c.createdAt
      if (!at) continue
      items.push({
        id: `${t.id}:call:${c.callId}`,
        at,
        title: `Call linked to ${name}`,
        detail: `${c.inbound ? 'Inbound' : 'Outbound'} · ${c.answered ? 'Answered' : 'Missed'} · ${c.duration || 0}s`,
        by: shortActor(c.userName) || shortActor(c.userEmail),
      })
    }
  }

  for (const log of logs) {
    const action = String(log.action || '').toUpperCase()
    if (!action || action === 'SCHEDULER_RUN' || action === 'BATCH_PROCESS') continue
    const at = log.createdAt
    if (!at) continue
    const details = log.details || {}
    const by = shortActor(
      typeof details.by === 'string'
        ? details.by
        : typeof details.byEmail === 'string'
          ? details.byEmail
          : null,
    )
    const linked = log.taskId ? taskById.get(String(log.taskId)) : undefined
    const name = linked ? taskName(linked) : 'Care task'

    // Skip log rows already covered by task-derived events
    if (
      action === 'NOTE_ADDED' ||
      action === 'CALL_ATTACHED' ||
      action === 'TASK_CREATED' ||
      action === 'TASK_COMPLETED' ||
      action === 'TASK_UNREACHABLE' ||
      action === 'TASK_CALL_AFTER' ||
      action === 'TASK_NOT_INTERESTED' ||
      action === 'TASK_ESCALATED' ||
      action === 'TASK_RESCHEDULED'
    ) {
      continue
    }

    const detailParts = [
      typeof details.outcome === 'string' ? details.outcome : '',
      typeof details.remarks === 'string' ? details.remarks : '',
      typeof details.customerResponse === 'string' ? details.customerResponse : '',
    ].filter(Boolean)

    items.push({
      id: `log:${log.id}`,
      at,
      title: `${name}: ${action.replace(/^TASK_/, '').replace(/_/g, ' ').toLowerCase()}`,
      detail: detailParts[0] || undefined,
      by,
    })
  }

  const seen = new Set<string>()
  return items
    .filter((item) => {
      const key = `${item.title}|${item.at}|${item.detail || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return Boolean(item.at)
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

