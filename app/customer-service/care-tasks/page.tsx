'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  StickyNote,
  User,
  MoreHorizontal,
  X,
  Star,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { CallAudioPlayer } from '@/components/customer-service/CallAudioPlayer'
import { ErrorToast } from '@/components/ErrorToast'
import {
  addCareTaskNote,
  generateCareTasks,
  getCareOrderContext,
  getCarePerformance,
  getCareTaskSummary,
  listCareTasks,
  syncCareTaskCalls,
  updateCareTask,
  type CareTask,
  type CareTaskSummary,
  type ExecutivePerformance,
} from '@/lib/careTasksApi'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import {
  CARE_TASK_KIND_TABS,
  CALL_AFTER_MAX_MS,
  getCareTaskKind,
  requiresCustomerRating,
  type CareTaskKind,
} from '@/src/services/careTasks/types'
import type { TimelineStep } from '@/src/utils/orderTimeline'

type StatusFilter =
  | 'inbox'
  | 'today'
  | 'overdue'
  | 'upcoming'
  | 'rescheduled'
  | 'escalated'
  | 'completed'
  | 'all'
type PageSize = 20 | 50 | 100

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100]
const REMINDER_SEEN_KEY = 'fiberise_care_unreachable_reminders'

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function loadReminderSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(REMINDER_SEEN_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function saveReminderSeen(seen: Set<string>) {
  localStorage.setItem(REMINDER_SEEN_KEY, JSON.stringify([...seen].slice(-100)))
}

function fmtWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDay(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function badge(tone: 'red' | 'amber' | 'emerald' | 'blue' | 'purple' | 'muted' | 'neutral') {
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

function TimelineRail({ steps }: { steps: TimelineStep[] }) {
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

type OrderContext = {
  order: any
  operational: any
  parent: any
  clones: any[]
  delivered: boolean
  statusLabel: string
  timeline: TimelineStep[]
}

function isTaskOverdue(task: CareTask) {
  if (task.status !== 'pending' && task.status !== 'rescheduled') return false
  return Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() < Date.now())
}

function statusBadge(task: CareTask) {
  if (task.status === 'completed') return { label: 'Done', tone: 'emerald' as const }
  if (task.status === 'escalated') return { label: 'Escalated', tone: 'red' as const }
  if (task.status === 'unreachable') return { label: 'Unreachable', tone: 'amber' as const }
  if (isTaskOverdue(task)) return { label: 'Overdue', tone: 'red' as const }
  if (task.status === 'rescheduled') return { label: 'Call after', tone: 'blue' as const }
  return { label: 'Pending', tone: 'amber' as const }
}

function pushLocalNotif(title: string, body: string, type: 'order' | 'system' | 'alert') {
  try {
    const key = 'fiberise_notifications'
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    const next = [
      {
        id: `care-${Date.now()}`,
        title,
        body,
        time: 'Just now',
        createdAt: Date.now(),
        unread: true,
        type,
      },
      ...(Array.isArray(list) ? list : []),
    ].slice(0, 50)
    localStorage.setItem(key, JSON.stringify(next))
    window.dispatchEvent(new Event('fiberise_notifications_updated'))
  } catch {
    // ignore
  }
}

export default function CareTasksPage() {
  const { user } = useAuth()
  const role = user?.role || null
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [summary, setSummary] = useState<CareTaskSummary | null>(null)
  const [performance, setPerformance] = useState<ExecutivePerformance[]>([])
  const [kindFilter, setKindFilter] = useState<CareTaskKind | 'all'>('cod_confirmation')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showMoreTools, setShowMoreTools] = useState(false)
  const [orderCtx, setOrderCtx] = useState<OrderContext | null>(null)
  const [orderCtxLoading, setOrderCtxLoading] = useState(false)
  const [orderCtxError, setOrderCtxError] = useState<string | null>(null)
  const autoGenerateTried = useRef(false)
  const loadSeq = useRef(0)
  const execDefaultsApplied = useRef(false)

  const [outcome, setOutcome] = useState('')
  const [remarks, setRemarks] = useState('')
  const [customerResponse, setCustomerResponse] = useState('')
  const [customerRating, setCustomerRating] = useState(0)
  const [noteText, setNoteText] = useState('')
  const [rescheduleAt, setRescheduleAt] = useState('')
  const [callAfterAt, setCallAfterAt] = useState('')
  const [escalateReason, setEscalateReason] = useState('')
  const [unreachableConfirmTask, setUnreachableConfirmTask] = useState<CareTask | null>(null)
  const [escalateConfirmTask, setEscalateConfirmTask] = useState<CareTask | null>(null)
  const [callAfterConfirmTask, setCallAfterConfirmTask] = useState<CareTask | null>(null)
  const [reminderTask, setReminderTask] = useState<CareTask | null>(null)

  const isAdmin = isAdminRole(role)
  const isExec = isCareExecutiveRole(role)

  // Care executives: unified open queue, COD first (no kind tabs)
  useEffect(() => {
    if (!isExec || execDefaultsApplied.current) return
    execDefaultsApplied.current = true
    setKindFilter('all')
    setStatusFilter('inbox')
  }, [isExec])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])

  // Server-paginated list — only the current page is returned.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    // Keep previous rows visible while refreshing (no empty flash)
    try {
      const listRes = await listCareTasks({
        status: statusFilter,
        kind: isExec || kindFilter === 'all' ? 'all' : kindFilter,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      })
      if (seq !== loadSeq.current) return null

      setTasks(listRes.tasks)
      setTotal(listRes.total)
      setTotalPages(listRes.totalPages)
      setKindCounts(listRes.kindCounts || {})
      if (listRes.page !== page) setPage(listRes.page)
      setLoading(false)

      // Summary + performance after list paints (shared server cache makes this cheap)
      void getCareTaskSummary()
        .then((sum) => {
          if (seq === loadSeq.current) setSummary(sum)
        })
        .catch(() => {})

      if (isAdmin) {
        void getCarePerformance()
          .then((rows) => {
            if (seq === loadSeq.current) setPerformance(rows)
          })
          .catch(() => {
            if (seq === loadSeq.current) setPerformance([])
          })
      }
      return listRes.total
    } catch (err: any) {
      if (seq === loadSeq.current) {
        setError(err?.message || 'Failed to load care tasks')
        setLoading(false)
      }
      return null
    }
  }, [statusFilter, kindFilter, debouncedSearch, page, pageSize, isAdmin, isExec])

  const runGenerate = useCallback(
    async (silent = false) => {
      setGenerating(true)
      if (!silent) setError(null)
      try {
        // Pull latest Shopify orders into cache, then create missing COD tasks
        const data = await generateCareTasks(200, true)
        const r = data?.result
        if (!silent) {
          const created = r?.confirmationCreated ?? 0
          const followups = r?.followupsCreated ?? 0
          const pulled = data?.shopifyPulled ?? 0
          setSuccess(
            created || followups
              ? `Synced ${pulled} Shopify orders — ${created} new COD confirmation, ${followups} follow-ups`
              : `Synced ${pulled} Shopify orders — no new tasks (already up to date)`,
          )
        }
        if (page !== 1) setPage(1)
        else await load()
      } catch (err: any) {
        if (!silent) setError(err?.message || 'Failed to sync / generate tasks')
      } finally {
        setGenerating(false)
      }
    },
    [load, page],
  )

  // Search / page-size changes jump back to page 1 (batched with the filter update).
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, pageSize])

  useEffect(() => {
    if (role === null) return
    ;(async () => {
      const totalCount = await load()
      if (!autoGenerateTried.current && totalCount === 0) {
        autoGenerateTried.current = true
        await runGenerate(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, statusFilter, kindFilter, debouncedSearch, page, pageSize])

  const safePage = Math.min(page, totalPages)
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize
  const pageEnd = Math.min(pageStart + tasks.length, total)

  const goToPage = (next: number) => {
    setExpandedId(null)
    setPage(Math.min(Math.max(1, next), totalPages))
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  useEffect(() => {
    setOutcome('')
    setRemarks('')
    setCustomerResponse('')
    setCustomerRating(0)
    setNoteText('')
    setRescheduleAt('')
    setCallAfterAt('')
    setEscalateReason('')
    setOrderCtx(null)
    setOrderCtxError(null)

    if (!expandedId) return
    const task = tasks.find((t) => t.id === expandedId)
    if (!task) return

    let cancelled = false
    ;(async () => {
      setOrderCtxLoading(true)
      try {
        const ctx = await getCareOrderContext(task.orderId, task.orderName)
        if (!cancelled) setOrderCtx(ctx)
      } catch (err: any) {
        if (!cancelled) setOrderCtxError(err?.message || 'Could not load order trail')
      } finally {
        if (!cancelled) setOrderCtxLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId])

  // Reminder popup when a previously-unreachable task becomes due again
  useEffect(() => {
    const check = () => {
      const now = Date.now()
      const seen = loadReminderSeen()
      const due = tasks.find(
        (t) =>
          t.lastUnreachableAt &&
          (t.status === 'pending' || t.status === 'rescheduled') &&
          new Date(t.scheduledAt).getTime() <= now &&
          !seen.has(`${t.id}:${t.lastUnreachableAt}`),
      )
      if (due && !reminderTask) {
        setReminderTask(due)
      }
    }
    check()
    const id = window.setInterval(check, 15_000)
    return () => window.clearInterval(id)
  }, [tasks, reminderTask])

  // Same KPI cards for admin and executives so dashboards match
  const cards = useMemo(() => {
    if (!summary) return []
    return [
      { label: 'Total', value: summary.total },
      { label: 'Pending', value: summary.pending },
      { label: 'Overdue', value: summary.overdue },
      { label: 'Done', value: summary.completed },
    ]
  }, [summary])

  const onAction = async (task: CareTask, action: string) => {
    try {
      setSavingId(task.id)
      setError(null)
      setSuccess(null)
      if (action === 'confirm_cod') {
        await updateCareTask(task.id, { action: 'confirm_cod' })
        setSuccess(`Tagged ${task.orderName} as Care confirmed (Orders / Order Status)`)
        setExpandedId(null)
      } else if (action === 'cancel_cod') {
        await updateCareTask(task.id, { action: 'cancel_cod' })
        setSuccess(`Tagged ${task.orderName} as Care cancelled (display only — order not cancelled)`)
        setExpandedId(null)
      } else if (action === 'complete') {
        if (requiresCustomerRating(task) && (customerRating < 1 || customerRating > 5)) {
          throw new Error('Please rate the customer (1–5 stars) before completing')
        }
        await updateCareTask(task.id, {
          action: 'complete',
          outcome,
          remarks,
          customerResponse,
          ...(requiresCustomerRating(task) ? { customerRating } : {}),
        })
        setSuccess('Task completed')
        setExpandedId(null)
      } else if (action === 'unreachable') {
        await updateCareTask(task.id, {
          action: 'unreachable',
          remarks: remarks || 'Customer unreachable',
        })
        setUnreachableConfirmTask(null)
        setSuccess('Marked unreachable — task will return in 1 hour')
        setExpandedId(null)
      } else if (action === 'escalate') {
        const reason = escalateReason.trim()
        if (!reason) throw new Error('Escalate reason is required')
        await updateCareTask(task.id, { action: 'escalate', remarks: reason })
        setEscalateConfirmTask(null)
        setEscalateReason('')
        setSuccess('Escalated to admin')
        pushLocalNotif('Care task escalated', `${task.orderName} — ${task.taskLabel}`, 'alert')
        setExpandedId(null)
      } else if (action === 'call_after') {
        if (!callAfterAt) throw new Error('Pick a call-after date & time first')
        const when = new Date(callAfterAt).getTime()
        if (Number.isNaN(when)) throw new Error('Invalid call-after date')
        if (when > Date.now() + CALL_AFTER_MAX_MS) {
          throw new Error('Call After can be at most 3 days from now')
        }
        if (when < Date.now() - 60_000) throw new Error('Call-after time must be in the future')
        await updateCareTask(task.id, {
          action: 'call_after',
          scheduledAt: new Date(when).toISOString(),
          remarks,
        })
        setCallAfterConfirmTask(null)
        setCallAfterAt('')
        setSuccess('Scheduled call after')
        setExpandedId(null)
      } else if (action === 'reschedule') {
        if (!rescheduleAt) throw new Error('Pick a new date & time first')
        await updateCareTask(task.id, {
          action: 'reschedule',
          scheduledAt: new Date(rescheduleAt).toISOString(),
          remarks,
        })
        setSuccess('Rescheduled')
      }
      await load()
    } catch (err: any) {
      setError(err?.message || 'Action failed')
    } finally {
      setSavingId(null)
    }
  }

  const onAddNote = async (task: CareTask) => {
    if (!noteText.trim()) return
    try {
      setSavingId(task.id)
      await addCareTaskNote(task.id, noteText.trim())
      setNoteText('')
      setSuccess('Note saved')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to add note')
    } finally {
      setSavingId(null)
    }
  }

  const statusFilters: Array<[StatusFilter, string]> = [
    ['inbox', 'To do'],
    ['overdue', 'Overdue'],
    ['rescheduled', 'Rescheduled'],
    ['escalated', 'Escalated'],
    ['completed', 'Done'],
    ['all', 'All'],
  ]

  const statusFilterCounts: Partial<Record<StatusFilter, number>> = summary
    ? {
        inbox: summary.pending,
        overdue: summary.overdue,
        rescheduled: summary.rescheduled,
        escalated: summary.escalated,
        completed: summary.completed,
        all: summary.total,
      }
    : {}

  const visibleKindTabs = useMemo(() => {
    return CARE_TASK_KIND_TABS.filter((tab) => {
      if (tab.key === 'other') return (kindCounts.other || 0) > 0
      if (
        tab.key === 'cod_confirmation' ||
        tab.key === 'introduction' ||
        tab.key === 'day_3' ||
        tab.key === 'day_5'
      ) {
        return true
      }
      return (kindCounts[tab.key] || 0) > 0
    })
  }, [kindCounts])

  const activeKindLabel =
    kindFilter === 'all'
      ? 'All tasks'
      : CARE_TASK_KIND_TABS.find((t) => t.key === kindFilter)?.label || 'Tasks'

  const callAfterMin = toDatetimeLocalValue(new Date())
  const callAfterMax = toDatetimeLocalValue(new Date(Date.now() + CALL_AFTER_MAX_MS))

  const dismissReminder = (open: boolean) => {
    if (reminderTask?.lastUnreachableAt) {
      const seen = loadReminderSeen()
      seen.add(`${reminderTask.id}:${reminderTask.lastUnreachableAt}`)
      saveReminderSeen(seen)
    }
    if (open && reminderTask) setExpandedId(reminderTask.id)
    setReminderTask(null)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-6xl mx-auto mt-20">
          {!isExec && <SubNav />}

          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
                Tasks
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                Call the customer, then mark the task done.
              </p>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                onClick={() => runGenerate(false)}
                disabled={loading || generating}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
                title="Pull latest Shopify COD orders and create missing tasks"
              >
                <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                {generating ? 'Syncing…' : 'Sync new orders'}
              </button>
              <button
                onClick={() => load()}
                disabled={loading || generating}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border disabled:opacity-50"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                  background: 'var(--card)',
                }}
              >
                Refresh list
              </button>
              <button
                type="button"
                onClick={() => setShowMoreTools((v) => !v)}
                className="p-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                title="More"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showMoreTools && (
                <div
                  className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl border shadow-lg py-1"
                  style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                >
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-purple-500/10"
                    style={{ color: 'var(--foreground)' }}
                    disabled={generating}
                    onClick={() => {
                      setShowMoreTools(false)
                      runGenerate(false)
                    }}
                  >
                    {generating ? 'Syncing…' : 'Sync Shopify + generate tasks'}
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-purple-500/10"
                    style={{ color: 'var(--foreground)' }}
                    onClick={() => {
                      setShowMoreTools(false)
                      ;(async () => {
                        try {
                          setLoading(true)
                          const data = await syncCareTaskCalls(48)
                          setSuccess(`Calls synced (${data?.result?.attached ?? 0} linked)`)
                          await load()
                        } catch (err: any) {
                          setError(err?.message || 'Call sync failed')
                        } finally {
                          setLoading(false)
                        }
                      })()
                    }}
                  >
                    Sync Salestrail calls
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Compact stats */}
          <div className="grid grid-cols-4 gap-2 mb-5">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-xl px-3 py-2.5 border"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                  {c.label}
                </p>
                <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--foreground)' }}>
                  {c.value}
                </p>
              </div>
            ))}
          </div>

          {isAdmin && performance.length > 0 && (
            <div
              className="mb-5 rounded-xl border overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <div className="px-4 py-2.5 border-b text-sm font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                Team performance
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                      <th className="px-4 py-2">Executive</th>
                      <th className="px-3 py-2">Assigned</th>
                      <th className="px-3 py-2">Done</th>
                      <th className="px-3 py-2">Pending</th>
                      <th className="px-3 py-2">Overdue</th>
                      <th className="px-3 py-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((row) => (
                      <tr key={row.email} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-4 py-2" style={{ color: 'var(--foreground)' }}>
                          <div className="font-medium">{row.name}</div>
                          <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>{row.email}</div>
                        </td>
                        <td className="px-3 py-2">{row.assigned}</td>
                        <td className="px-3 py-2">{row.completed}</td>
                        <td className="px-3 py-2">{row.pending}</td>
                        <td className="px-3 py-2 text-red-500">{row.overdue}</td>
                        <td className="px-3 py-2">{row.completionPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Call-type tabs — admins only; care executives see a unified list */}
          {!isExec ? (
          <div
            className="mb-3 flex gap-1 overflow-x-auto pb-1 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            {visibleKindTabs.map((tab) => {
              const active = kindFilter === tab.key
              const count = kindCounts[tab.key] || 0
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    if (tab.key === kindFilter) return
                    setKindFilter(tab.key)
                    setPage(1)
                    setExpandedId(null)
                  }}
                  className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    active
                      ? 'border-purple-600 text-purple-700 dark:text-purple-300'
                      : 'border-transparent'
                  }`}
                  style={active ? undefined : { color: 'var(--foreground-muted)' }}
                >
                  {tab.label}
                  <span
                    className={`ml-1.5 tabular-nums ${active ? 'opacity-80' : 'opacity-50'}`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          ) : (
            <p className="mb-3 text-sm font-medium" style={{ color: 'var(--foreground-muted)' }}>
              COD confirmation first · all call types
            </p>
          )}

          {/* Status + search */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {statusFilters.map(([value, label]) => {
                const active = statusFilter === value
                const count = statusFilterCounts[value]
                return (
                  <button
                    key={value}
                    onClick={() => {
                      if (value === statusFilter) return
                      setStatusFilter(value)
                      setPage(1)
                      setExpandedId(null)
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      active ? 'bg-purple-600 text-white' : ''
                    }`}
                    style={
                      active
                        ? undefined
                        : { color: 'var(--foreground-muted)', background: 'transparent' }
                    }
                  >
                    {label}
                    {typeof count === 'number' ? (
                      <span className={`ml-1.5 tabular-nums ${active ? 'opacity-80' : 'opacity-50'}`}>
                        {count}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--foreground-muted)' }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer or order"
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                style={{
                  background: 'var(--card)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>
          </div>

          {loading && tasks.length === 0 ? (
            <div className="space-y-2.5" aria-busy="true" aria-label="Loading tasks">
              <div
                className="flex items-center justify-center gap-2 py-6 text-sm"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                Loading tasks…
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border p-4 animate-pulse"
                  style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-4 space-y-2">
                      <div className="h-3 w-20 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-4 w-40 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-3 w-32 rounded bg-black/5 dark:bg-white/5" />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                      <div className="h-3 w-16 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-4 w-28 rounded bg-black/10 dark:bg-white/10" />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                      <div className="h-3 w-12 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-4 w-24 rounded bg-black/10 dark:bg-white/10" />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <div className="h-3 w-16 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-4 w-full rounded bg-black/5 dark:bg-white/5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : total === 0 ? (
            <div
              className="rounded-xl border px-6 py-14 text-center"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                No {activeKindLabel.toLowerCase()} tasks
              </p>
              <p className="text-sm mt-1 mb-4" style={{ color: 'var(--foreground-muted)' }}>
                {debouncedSearch
                  ? 'Nothing matches this search. Try another query or clear filters.'
                  : statusFilter === 'rescheduled'
                    ? 'No Call After / unreachable reschedules right now.'
                    : statusFilter === 'escalated'
                      ? 'No escalated tasks right now.'
                      : 'Nothing for this status yet. Try Generate tasks from COD orders.'}
              </p>
              {!debouncedSearch &&
                statusFilter !== 'rescheduled' &&
                statusFilter !== 'escalated' &&
                statusFilter !== 'completed' && (
                <button
                  onClick={() => runGenerate(false)}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
                >
                  {generating ? 'Generating…' : 'Generate tasks'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <p>
                  Showing{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {pageStart + 1}–{pageEnd}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {total.toLocaleString('en-IN')}
                  </span>
                </p>
                <label className="inline-flex items-center gap-2">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                    className="px-2 py-1.5 rounded-lg border text-xs"
                    style={{
                      background: 'var(--card)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {tasks.map((task) => {
                const expanded = expandedId === task.id
                const st = statusBadge(task)
                const overdue = isTaskOverdue(task)
                const busy = savingId === task.id
                const isCodConfirm =
                  getCareTaskKind(task) === 'cod_confirmation' && task.status !== 'completed'

                return (
                  <div
                    key={task.id}
                    className={`crm-card overflow-hidden border ${overdue ? 'ring-1 ring-red-500/35' : ''}`}
                    style={{
                      borderColor: overdue ? 'rgba(239, 68, 68, 0.45)' : 'var(--border)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : task.id)}
                      className="w-full text-left p-4 hover:bg-purple-500/[0.03] transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                          {expanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-3">
                          <div className="md:col-span-4">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              {getCareTaskKind(task) === 'cod_confirmation' && (
                                <span className={badge('purple')}>COD</span>
                              )}
                              <span className={badge(st.tone)}>{st.label}</span>
                              {task.priority === 'high' && (
                                <span className={badge('red')}>High</span>
                              )}
                            </div>
                            <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                              {task.taskLabel}
                            </p>
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              {task.orderName}
                              {task.packLabel ? ` · ${task.packLabel}` : ''}
                              {task.orderCreatedAt ? ` · ordered ${fmtDay(task.orderCreatedAt)}` : ''}
                            </p>
                          </div>

                          <div className="md:col-span-3">
                            <p
                              className="text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              Customer
                            </p>
                            <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--foreground)' }}>
                              <User className="w-3.5 h-3.5 opacity-50" />
                              {task.customerName}
                            </p>
                            <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              <Phone className="w-3 h-3" />
                              {task.phone || '—'}
                            </p>
                          </div>

                          <div className="md:col-span-3">
                            <p
                              className="text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              {task.status === 'rescheduled' ? 'Call after' : 'Due'}
                            </p>
                            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                              {fmtDay(task.scheduledAt)}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                              {fmtWhen(task.scheduledAt)}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p
                              className="text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              Last note
                            </p>
                            <p className="text-[12px] line-clamp-2" style={{ color: 'var(--foreground-muted)' }}>
                              {task.notes?.[0]?.text || task.remarks || 'No notes yet'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>

                    {isCodConfirm && (
                      <div
                        className="flex flex-wrap items-center gap-2 px-4 pb-3 -mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAction(task, 'confirm_cod')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
                          title="Tag order as confirmed by care (does not change Shopify)"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Confirm order
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAction(task, 'cancel_cod')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 disabled:opacity-50"
                          title="Tag cancel request for ops — does NOT cancel the Shopify order"
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel request
                        </button>
                        <span className="text-[10px]" style={{ color: 'var(--foreground-muted)' }}>
                          Tags only — shown on Orders & Order Status
                        </span>
                      </div>
                    )}

                    {expanded && (
                      <div
                        className="border-t px-4 lg:px-5 py-4 space-y-5"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        {/* Meta strip — no nested cards */}
                        <div
                          className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          <span>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                              Order created
                            </span>{' '}
                            {fmtWhen(task.orderCreatedAt)}
                          </span>
                          <span>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Pack</span>{' '}
                            {task.packLabel || '—'}
                          </span>
                          <span>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Call due</span>{' '}
                            {task.scheduleDay < 0
                              ? 'Right after order placed'
                              : `Day ${task.scheduleDay} after delivery`}
                          </span>
                          {isAdmin && (
                            <span>
                              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Assignee</span>{' '}
                              {task.assignedTo?.email || '—'}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last call:{' '}
                            {task.lastCall
                              ? fmtWhen(task.lastCall.startTime || task.lastCall.createdAt)
                              : 'None'}
                          </span>
                          {orderCtx?.operational && (
                            <span>
                              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                                Fulfillment
                              </span>{' '}
                              {orderCtx.statusLabel}
                              {orderCtx.operational.awb ? ` · ${orderCtx.operational.awb}` : ''}
                              {orderCtx.operational.courier
                                ? ` · ${orderCtx.operational.courier}`
                                : ''}
                            </span>
                          )}
                        </div>

                        {/* Order timeline + clone trail (same idea as Order Status) */}
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase tracking-wider mb-2"
                            style={{ color: 'var(--foreground-muted)' }}
                          >
                            Order trail
                          </p>
                          {orderCtxLoading && (
                            <p
                              className="text-sm flex items-center gap-2"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              <Loader2 className="w-4 h-4 animate-spin" /> Loading shipment trail…
                            </p>
                          )}
                          {orderCtxError && (
                            <p className="text-sm text-red-500">{orderCtxError}</p>
                          )}
                          {!orderCtxLoading && orderCtx && (
                            <div className="space-y-4">
                              <div>
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                  <p
                                    className="text-xs font-semibold"
                                    style={{ color: 'var(--foreground)' }}
                                  >
                                    {orderCtx.delivered ? 'Order timeline' : 'Shipment timeline'}
                                  </p>
                                  {!orderCtx.delivered && (
                                    <span className={badge('amber')}>
                                      {orderCtx.statusLabel}
                                      {orderCtx.operational?.etd
                                        ? ` · ETD ${fmtDay(orderCtx.operational.etd)}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                                {orderCtx.timeline?.length ? (
                                  <TimelineRail steps={orderCtx.timeline} />
                                ) : (
                                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                                    No timeline steps yet.
                                  </p>
                                )}
                              </div>

                              {(orderCtx.clones?.length > 0 || orderCtx.parent) && (
                                <div>
                                  <p
                                    className="text-xs font-semibold mb-2"
                                    style={{ color: 'var(--foreground)' }}
                                  >
                                    Clone order trail
                                  </p>
                                  <div className="overflow-x-auto pb-1">
                                    <ol className="flex items-stretch gap-0 min-w-min">
                                      {(() => {
                                        const nodes = [
                                          {
                                            key: 'original',
                                            title: 'Original',
                                            name: (orderCtx.parent || orderCtx.order)?.name,
                                            sub: (orderCtx.parent || orderCtx.order)?.statusLabel,
                                            awb: (orderCtx.parent || orderCtx.order)?.awb,
                                            active: false,
                                          },
                                          ...(orderCtx.clones || []).map(
                                            (clone: any, idx: number) => ({
                                              key: String(clone.id),
                                              title: `Clone${orderCtx.clones.length > 1 ? ` ${idx + 1}` : ''}${
                                                idx === orderCtx.clones.length - 1 ? ' · active' : ''
                                              }`,
                                              name: clone.name,
                                              sub: `${fmtDay(clone.created_at)} · ${clone.statusLabel}`,
                                              awb: clone.awb,
                                              active: idx === orderCtx.clones.length - 1,
                                            }),
                                          ),
                                        ]
                                        return nodes.map((node, idx) => (
                                          <li key={node.key} className="flex items-center shrink-0">
                                            <div
                                              className="w-44 rounded-lg border p-2.5"
                                              style={{
                                                borderColor: node.active
                                                  ? 'rgba(16, 185, 129, 0.45)'
                                                  : 'var(--border)',
                                              }}
                                            >
                                              <p
                                                className={`text-[10px] font-bold uppercase ${
                                                  node.active ? 'text-emerald-600' : ''
                                                }`}
                                                style={
                                                  node.active
                                                    ? undefined
                                                    : { color: 'var(--foreground-muted)' }
                                                }
                                              >
                                                {node.title}
                                              </p>
                                              <p
                                                className="text-sm font-extrabold truncate"
                                                style={{ color: 'var(--foreground)' }}
                                              >
                                                {node.name}
                                              </p>
                                              <p
                                                className="text-[11px] line-clamp-2"
                                                style={{ color: 'var(--foreground-muted)' }}
                                              >
                                                {node.sub}
                                                {node.awb ? ` · ${node.awb}` : ''}
                                              </p>
                                            </div>
                                            {idx < nodes.length - 1 && (
                                              <div
                                                className="w-6 h-0.5 mx-1 rounded-full shrink-0"
                                                style={{ background: 'rgba(16, 185, 129, 0.45)' }}
                                              />
                                            )}
                                          </li>
                                        ))
                                      })()}
                                    </ol>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Compact activity */}
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase tracking-wider mb-2"
                            style={{ color: 'var(--foreground-muted)' }}
                          >
                            Activity
                          </p>
                          <ul className="space-y-1.5 text-sm">
                            <li style={{ color: 'var(--foreground)' }}>
                              Created · <span style={{ color: 'var(--foreground-muted)' }}>{fmtWhen(task.createdAt)}</span>
                            </li>
                            <li style={{ color: 'var(--foreground)' }}>
                              Scheduled · <span style={{ color: 'var(--foreground-muted)' }}>{fmtWhen(task.scheduledAt)}</span>
                            </li>
                            {(task.rescheduledAt || task.status === 'rescheduled') && (
                              <>
                                <li style={{ color: 'var(--foreground)' }}>
                                  Call after requested ·{' '}
                                  <span style={{ color: 'var(--foreground-muted)' }}>
                                    {fmtWhen(task.rescheduledAt || task.updatedAt || task.createdAt)}
                                  </span>
                                </li>
                                <li style={{ color: 'var(--foreground)' }}>
                                  {new Date(task.scheduledAt).getTime() <= Date.now()
                                    ? 'Moved to To do · '
                                    : 'Moves to To do · '}
                                  <span style={{ color: 'var(--foreground-muted)' }}>
                                    {fmtWhen(task.scheduledAt)}
                                  </span>
                                </li>
                              </>
                            )}
                            {task.lastUnreachableAt && (
                              <li style={{ color: 'var(--foreground)' }}>
                                Marked unreachable ·{' '}
                                <span style={{ color: 'var(--foreground-muted)' }}>
                                  {fmtWhen(task.lastUnreachableAt)}
                                </span>
                              </li>
                            )}
                            {(task.notes || []).slice(0, 3).map((n) => (
                              <li key={n.id} style={{ color: 'var(--foreground)' }}>
                                <StickyNote className="w-3 h-3 inline mr-1 opacity-50" />
                                {n.text}{' '}
                                <span style={{ color: 'var(--foreground-muted)' }}>· {fmtWhen(n.createdAt)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Calls — only if present, else one quiet line */}
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase tracking-wider mb-2"
                            style={{ color: 'var(--foreground-muted)' }}
                          >
                            Calls
                          </p>
                          {(task.calls || []).length === 0 ? (
                            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                              No Salestrail calls linked yet. Use ⋮ → Sync Salestrail calls after dialing.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {(task.calls || []).map((c) => (
                                <div key={c.callId} className="py-2 border-t first:border-0" style={{ borderColor: 'var(--border)' }}>
                                  <p className="text-[12px] mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
                                    {fmtWhen(c.startTime || c.createdAt)} · {c.inbound ? 'Inbound' : 'Outbound'} ·{' '}
                                    {c.answered ? 'Answered' : 'Missed'} · {c.duration || 0}s
                                  </p>
                                  {c.hasRecording ? (
                                    <CallAudioPlayer callId={c.callId} />
                                  ) : (
                                    <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                                      Recording not available
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Complete / update — clear single form */}
                        {task.status !== 'completed' ? (
                          <div
                            className="pt-4 border-t space-y-3"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                              After the call
                            </p>
                            <div className="grid grid-cols-1 gap-2.5">
                              <label className="block">
                                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                  Call outcome
                                </span>
                                <input
                                  value={outcome}
                                  onChange={(e) => setOutcome(e.target.value)}
                                  placeholder="e.g. Confirmed address, will accept delivery"
                                  className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                                  style={{
                                    background: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                />
                              </label>
                              <label className="block">
                                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                  Customer response
                                </span>
                                <input
                                  value={customerResponse}
                                  onChange={(e) => setCustomerResponse(e.target.value)}
                                  placeholder="e.g. Happy with order, asked about delivery date"
                                  className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                                  style={{
                                    background: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                />
                              </label>
                              <label className="block">
                                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                  Remarks
                                </span>
                                <input
                                  value={remarks}
                                  onChange={(e) => setRemarks(e.target.value)}
                                  placeholder="Anything else for the next agent"
                                  className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                                  style={{
                                    background: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                />
                              </label>
                              {requiresCustomerRating(task) && (
                                <div>
                                  <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                    Customer rating * (1–5)
                                  </span>
                                  <div className="mt-1.5 flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setCustomerRating(n)}
                                        className="p-0.5 disabled:opacity-50"
                                        title={`${n} star${n > 1 ? 's' : ''}`}
                                      >
                                        <Star
                                          className={`w-6 h-6 ${
                                            n <= customerRating
                                              ? 'fill-amber-400 text-amber-400'
                                              : 'text-[var(--foreground-muted)]'
                                          }`}
                                        />
                                      </button>
                                    ))}
                                    {customerRating > 0 && (
                                      <span className="ml-2 text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
                                        {customerRating}/5
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex flex-nowrap items-center gap-2 pt-1 overflow-x-auto">
                              <button
                                disabled={busy}
                                onClick={() => onAction(task, 'complete')}
                                className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Mark completed
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => setUnreachableConfirmTask(task)}
                                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Unreachable
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setEscalateReason('')
                                  setEscalateConfirmTask(task)
                                }}
                                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Escalate
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setCallAfterAt(toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)))
                                  setCallAfterConfirmTask(task)
                                }}
                                className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                <Clock className="w-4 h-4" />
                                Call After
                              </button>
                            </div>

                            {!isExec && (
                            <div className="flex flex-wrap items-end gap-2 pt-1">
                              <label className="block">
                                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                  Reschedule
                                </span>
                                <input
                                  type="datetime-local"
                                  value={rescheduleAt}
                                  onChange={(e) => setRescheduleAt(e.target.value)}
                                  className="mt-1 block px-3 py-2 rounded-lg text-sm border"
                                  style={{
                                    background: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                />
                              </label>
                              <button
                                disabled={busy}
                                onClick={() => onAction(task, 'reschedule')}
                                className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Save new time
                              </button>
                            </div>
                            )}

                            <div className="flex gap-2 pt-1">
                              <input
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Quick note (optional)"
                                className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                                style={{
                                  background: 'var(--background)',
                                  borderColor: 'var(--border)',
                                  color: 'var(--foreground)',
                                }}
                              />
                              <button
                                disabled={busy || !noteText.trim()}
                                onClick={() => onAddNote(task)}
                                className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-40"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Add note
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="pt-3 border-t text-sm space-y-1"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          >
                            <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" /> Completed
                            </p>
                            <p style={{ color: 'var(--foreground-muted)' }}>Outcome: {task.outcome || '—'}</p>
                            <p style={{ color: 'var(--foreground-muted)' }}>
                              Response: {task.customerResponse || '—'}
                            </p>
                            <p style={{ color: 'var(--foreground-muted)' }}>Remarks: {task.remarks || '—'}</p>
                            {typeof task.customerRating === 'number' && (
                              <p style={{ color: 'var(--foreground-muted)' }} className="flex items-center gap-1">
                                Rating:{' '}
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <Star
                                    key={n}
                                    className={`w-3.5 h-3.5 ${
                                      n <= (task.customerRating || 0)
                                        ? 'fill-amber-400 text-amber-400'
                                        : 'text-[var(--foreground-muted)]'
                                    }`}
                                  />
                                ))}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <div
                className="sticky bottom-3 z-10 rounded-xl border p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Page{' '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {safePage}
                    </span>{' '}
                    of{' '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {totalPages}
                    </span>
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    <span>Per page</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                      className="px-2 py-1.5 rounded-lg border text-xs"
                      style={{
                        background: 'var(--background)',
                        borderColor: 'var(--border)',
                        color: 'var(--foreground)',
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => goToPage(1)}
                    disabled={safePage <= 1}
                    className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    First
                  </button>
                  <button
                    type="button"
                    onClick={() => goToPage(safePage - 1)}
                    disabled={safePage <= 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                    .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((item, idx) =>
                      item === 'ellipsis' ? (
                        <span
                          key={`e-${idx}`}
                          className="px-1 text-xs"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          …
                        </span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          onClick={() => goToPage(item)}
                          className={`min-w-[32px] px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                            item === safePage
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'hover:bg-purple-500/10'
                          }`}
                          style={
                            item === safePage
                              ? undefined
                              : { borderColor: 'var(--border)', color: 'var(--foreground)' }
                          }
                        >
                          {item}
                        </button>
                      ),
                    )}
                  <button
                    type="button"
                    onClick={() => goToPage(safePage + 1)}
                    disabled={safePage >= totalPages}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToPage(totalPages)}
                    disabled={safePage >= totalPages}
                    className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    Last
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 text-sm flex items-center gap-2 shadow-lg">
          <CheckCircle2 className="w-4 h-4" />
          {success}
          <button className="ml-2 opacity-60" onClick={() => setSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Unreachable confirmation */}
      {unreachableConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Customer unreachable
              </h3>
              <button
                type="button"
                onClick={() => setUnreachableConfirmTask(null)}
                className="p-1 rounded-lg"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--foreground-muted)' }}>
              We’ll bring <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{unreachableConfirmTask.orderName}</span> back
              as a reminder in <strong>1 hour</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnreachableConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === unreachableConfirmTask.id}
                onClick={() => onAction(unreachableConfirmTask, 'unreachable')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escalate reason popup */}
      {escalateConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Escalate task
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEscalateConfirmTask(null)
                  setEscalateReason('')
                }}
                className="p-1 rounded-lg"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--foreground-muted)' }}>
              {escalateConfirmTask.orderName} — {escalateConfirmTask.taskLabel}
            </p>
            <label className="block mb-4">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Reason *
              </span>
              <textarea
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                rows={3}
                placeholder="Why are you escalating this?"
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                style={{
                  background: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEscalateConfirmTask(null)
                  setEscalateReason('')
                }}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === escalateConfirmTask.id || !escalateReason.trim()}
                onClick={() => onAction(escalateConfirmTask, 'escalate')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call After popup */}
      {callAfterConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Call After
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCallAfterConfirmTask(null)
                  setCallAfterAt('')
                }}
                className="p-1 rounded-lg"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--foreground-muted)' }}>
              {callAfterConfirmTask.orderName} — schedule a callback within 3 days.
            </p>
            <label className="block mb-4">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Date & time *
              </span>
              <input
                type="datetime-local"
                value={callAfterAt}
                min={callAfterMin}
                max={callAfterMax}
                onChange={(e) => setCallAfterAt(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm border"
                style={{
                  background: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCallAfterConfirmTask(null)
                  setCallAfterAt('')
                }}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === callAfterConfirmTask.id || !callAfterAt}
                onClick={() => onAction(callAfterConfirmTask, 'call_after')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Due reminder for previously unreachable tasks */}
      {reminderTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600">
                <Phone className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                  Reminder: call again
                </h3>
                <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                  {reminderTask.orderName} — {reminderTask.taskLabel}
                  <br />
                  {reminderTask.customerName} · {reminderTask.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismissReminder(false)}
                className="p-1 rounded-lg"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => dismissReminder(false)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => dismissReminder(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white"
              >
                Open task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
