'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  StickyNote,
  User,
  MoreHorizontal,
  X,
  Star,
  Truck,
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
  getEscalationTargets,
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
import { parseFlexibleDate, type TimelineStep } from '@/src/utils/orderTimeline'
import { isCareTaskCodConfirmed } from '@/src/utils/careOrderTags'

type StatusFilter =
  | 'inbox'
  | 'today'
  | 'overdue'
  | 'upcoming'
  | 'rescheduled'
  | 'escalated'
  | 'not_interested'
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

function fmtDay(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value) || new Date(value)
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
  state?: string | null
  city?: string | null
  pincode?: string | null
  etd?: string | null
}

function isTaskOverdue(task: CareTask) {
  if (task.status !== 'pending' && task.status !== 'rescheduled') return false
  return Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() < Date.now())
}

function statusBadge(task: CareTask) {
  if (task.status === 'completed') return { label: 'Done', tone: 'emerald' as const }
  if (task.status === 'not_interested') return { label: 'Not interested', tone: 'muted' as const }
  if (task.status === 'escalated') return { label: 'Escalated', tone: 'red' as const }
  if (task.status === 'unreachable') return { label: 'Unreachable', tone: 'amber' as const }
  if (isTaskOverdue(task)) return { label: 'Overdue', tone: 'red' as const }
  if (task.status === 'rescheduled') return { label: 'Call after', tone: 'blue' as const }
  return { label: 'Pending', tone: 'amber' as const }
}

function escalationReason(task: CareTask): string {
  return String(task.remarks || task.notes?.[0]?.text || '').trim()
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
  const [orderCtxTaskId, setOrderCtxTaskId] = useState<string | null>(null)
  const [orderCtxLoading, setOrderCtxLoading] = useState(false)
  const [orderCtxError, setOrderCtxError] = useState<string | null>(null)
  const orderCtxFetchSeq = useRef(0)
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
  const [escalateTargetEmail, setEscalateTargetEmail] = useState('')
  const [escalationTargets, setEscalationTargets] = useState<
    Array<{ userId: string; email: string; name: string }>
  >([])
  const [unreachableConfirmTask, setUnreachableConfirmTask] = useState<CareTask | null>(null)
  const [escalateConfirmTask, setEscalateConfirmTask] = useState<CareTask | null>(null)
  const [callAfterConfirmTask, setCallAfterConfirmTask] = useState<CareTask | null>(null)
  const [notInterestedConfirmTask, setNotInterestedConfirmTask] = useState<CareTask | null>(null)
  const [notInterestedReason, setNotInterestedReason] = useState('')
  const [reminderTask, setReminderTask] = useState<CareTask | null>(null)
  const [panelEscalatedTasks, setPanelEscalatedTasks] = useState<CareTask[]>([])
  const [escalatedPanelOpen, setEscalatedPanelOpen] = useState(false)
  const [escalatedKindCounts, setEscalatedKindCounts] = useState<Record<string, number>>({})
  const [executiveFilter, setExecutiveFilter] = useState<string | null>(null)
  const taskListRef = useRef<HTMLDivElement | null>(null)

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

  const ensureEscalationTargets = useCallback(async () => {
    if (escalationTargets.length > 0) return escalationTargets
    try {
      const users = await getEscalationTargets()
      setEscalationTargets(users)
      return users
    } catch {
      setEscalationTargets([])
      return []
    }
  }, [escalationTargets])

  const panelKind = isExec || kindFilter === 'all' ? 'all' : kindFilter

  const loadPanelEscalated = useCallback(async () => {
    if (role === null) return
    try {
      const [panelRes, allRes] = await Promise.all([
        listCareTasks({ status: 'escalated', kind: panelKind, pageSize: 100 }),
        listCareTasks({ status: 'escalated', kind: 'all', pageSize: 100 }),
      ])
      setPanelEscalatedTasks(panelRes.tasks)
      const counts: Record<string, number> = {}
      for (const t of allRes.tasks) {
        const k = getCareTaskKind(t)
        counts[k] = (counts[k] || 0) + 1
      }
      setEscalatedKindCounts(counts)
    } catch {
      setPanelEscalatedTasks([])
      setEscalatedKindCounts({})
    }
  }, [role, panelKind])

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
        assignee: isAdmin && executiveFilter ? executiveFilter : undefined,
      })
      if (seq !== loadSeq.current) return null

      setTasks(listRes.tasks)
      setTotal(listRes.total)
      setTotalPages(listRes.totalPages)
      setKindCounts(listRes.kindCounts || {})
      if (listRes.page !== page) setPage(listRes.page)
      setLoading(false)

      // Summary + performance after list paints (shared server cache makes this cheap)
      void getCareTaskSummary(isAdmin && executiveFilter ? executiveFilter : undefined)
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

      void loadPanelEscalated()
      return listRes.total
    } catch (err: any) {
      if (seq === loadSeq.current) {
        setError(err?.message || 'Failed to load care tasks')
        setLoading(false)
      }
      return null
    }
  }, [statusFilter, kindFilter, debouncedSearch, page, pageSize, isAdmin, isExec, loadPanelEscalated, executiveFilter])

  const selectExecutive = useCallback((email: string, name: string) => {
    const normalized = email.toLowerCase()
    if (executiveFilter === normalized) {
      setExecutiveFilter(null)
      return
    }
    setExecutiveFilter(normalized)
    setKindFilter('all')
    setStatusFilter('inbox')
    setPage(1)
    setExpandedId(null)
    setSuccess(`Showing to-do tasks for ${name}`)
    window.setTimeout(() => {
      taskListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [executiveFilter])

  const runGenerate = useCallback(
    async (silent = false) => {
      setGenerating(true)
      if (!silent) setError(null)
      try {
        // Pull latest Shopify orders into cache, then create missing COD tasks
        const data = await generateCareTasks(200, true)
        const r = data?.result
        const redistributed = data?.tasksRedistributed ?? 0
        if (!silent) {
          const created = r?.confirmationCreated ?? 0
          const followups = r?.followupsCreated ?? 0
          const pulled = data?.shopifyPulled ?? 0
          const parts = [
            `Synced ${pulled} Shopify orders`,
            redistributed > 0 ? `${redistributed} tasks redistributed across executives` : null,
            created || followups
              ? `${created} new COD confirmation, ${followups} follow-ups`
              : 'no new tasks (already up to date)',
          ].filter(Boolean)
          setSuccess(parts.join(' — '))
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
  }, [role, statusFilter, kindFilter, debouncedSearch, page, pageSize, executiveFilter])

  useEffect(() => {
    if (role === null) return
    void loadPanelEscalated()
  }, [role, panelKind, loadPanelEscalated])

  const openEscalatedTask = (task: CareTask) => {
    setStatusFilter('escalated')
    setPage(1)
    setExpandedId(task.id)
    setEscalatedPanelOpen(false)
  }

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

  const expandedTask = useMemo(
    () => (expandedId ? tasks.find((t) => t.id === expandedId) ?? null : null),
    [expandedId, tasks],
  )

  const clearExpandedTaskUi = useCallback(() => {
    orderCtxFetchSeq.current += 1
    setOrderCtx(null)
    setOrderCtxTaskId(null)
    setOrderCtxError(null)
    setOrderCtxLoading(false)
    setOutcome('')
    setRemarks('')
    setCustomerResponse('')
    setCustomerRating(0)
    setNoteText('')
    setRescheduleAt('')
    setCallAfterAt('')
    setEscalateReason('')
  }, [])

  useEffect(() => {
    if (!expandedId) {
      clearExpandedTaskUi()
      return
    }
    if (!expandedTask) return

    clearExpandedTaskUi()
    const seq = ++orderCtxFetchSeq.current
    const taskId = expandedTask.id
    const { orderId, orderName } = expandedTask

    ;(async () => {
      setOrderCtxLoading(true)
      try {
        const ctx = await getCareOrderContext(orderId, orderName)
        if (seq !== orderCtxFetchSeq.current) return
        setOrderCtx(ctx)
        setOrderCtxTaskId(taskId)
      } catch (err: any) {
        if (seq !== orderCtxFetchSeq.current) return
        setOrderCtxError(err?.message || 'Could not load order trail')
      } finally {
        if (seq === orderCtxFetchSeq.current) setOrderCtxLoading(false)
      }
    })()
  }, [expandedId, expandedTask?.id, expandedTask?.orderId, expandedTask?.orderName, clearExpandedTaskUi])

  useEffect(() => {
    if (expandedId && !tasks.some((t) => t.id === expandedId)) {
      setExpandedId(null)
      clearExpandedTaskUi()
    }
  }, [tasks, expandedId, clearExpandedTaskUi])

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
    const form = {
      outcome,
      remarks,
      customerResponse,
      customerRating,
      rescheduleAt,
      callAfterAt,
      escalateReason,
      escalateTargetEmail,
      notInterestedReason,
    }
    try {
      setSavingId(task.id)
      setError(null)
      setSuccess(null)
      setExpandedId(null)
      clearExpandedTaskUi()
      if (action === 'confirm_cod') {
        await updateCareTask(task.id, { action: 'confirm_cod' })
        setSuccess(`Tagged ${task.orderName} as Care confirmed (Orders / Order Status)`)
      } else if (action === 'cancel_cod') {
        await updateCareTask(task.id, { action: 'cancel_cod' })
        setSuccess(`Tagged ${task.orderName} as Care cancelled (display only — order not cancelled)`)
      } else if (action === 'complete') {
        if (requiresCustomerRating(task) && (form.customerRating < 1 || form.customerRating > 5)) {
          throw new Error('Please rate the customer (1–5 stars) before completing')
        }
        await updateCareTask(task.id, {
          action: 'complete',
          outcome: form.outcome,
          remarks: form.remarks,
          customerResponse: form.customerResponse,
          ...(requiresCustomerRating(task) ? { customerRating: form.customerRating } : {}),
        })
        setSuccess('Task completed')
      } else if (action === 'unreachable') {
        await updateCareTask(task.id, {
          action: 'unreachable',
          remarks: form.remarks || 'Customer unreachable',
        })
        setUnreachableConfirmTask(null)
        setSuccess('Marked unreachable — task will return in 1 hour')
      } else if (action === 'escalate') {
        const reason = form.escalateReason.trim()
        if (!reason) throw new Error('Escalate reason is required')
        const target = escalationTargets.find((t) => t.email === form.escalateTargetEmail)
        if (!target) throw new Error('Select who to escalate this task to')
        await updateCareTask(task.id, { action: 'escalate', remarks: reason, escalatedTo: target })
        setEscalateConfirmTask(null)
        setSuccess(`Escalated to ${target.name || target.email}`)
        pushLocalNotif(
          'Care task escalated',
          `${task.orderName} — ${task.taskLabel} → ${target.name || target.email}`,
          'alert',
        )
      } else if (action === 'call_after') {
        if (!form.callAfterAt) throw new Error('Pick a call-after date & time first')
        const when = new Date(form.callAfterAt).getTime()
        if (Number.isNaN(when)) throw new Error('Invalid call-after date')
        if (when > Date.now() + CALL_AFTER_MAX_MS) {
          throw new Error('Call After can be at most 3 days from now')
        }
        if (when < Date.now() - 60_000) throw new Error('Call-after time must be in the future')
        await updateCareTask(task.id, {
          action: 'call_after',
          scheduledAt: new Date(when).toISOString(),
          remarks: form.remarks,
        })
        setCallAfterConfirmTask(null)
        setSuccess('Scheduled call after')
      } else if (action === 'not_interested') {
        const reason = form.notInterestedReason.trim()
        if (!reason) throw new Error('Please enter a reason')
        await updateCareTask(task.id, {
          action: 'not_interested',
          remarks: reason,
          customerResponse: form.customerResponse || 'Customer not interested',
        })
        setNotInterestedConfirmTask(null)
        setSuccess('Moved to Not interested')
      } else if (action === 'reschedule') {
        if (!form.rescheduleAt) throw new Error('Pick a new date & time first')
        const when = new Date(form.rescheduleAt).getTime()
        if (Number.isNaN(when)) throw new Error('Invalid reschedule date')
        if (when < Date.now() - 60_000) throw new Error('Reschedule time must be in the future')
        await updateCareTask(task.id, {
          action: 'reschedule',
          scheduledAt: new Date(when).toISOString(),
          remarks: form.remarks,
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
    ['not_interested', 'Not interested'],
    ['completed', 'Done'],
    ['all', 'All'],
  ]

  const statusFilterCounts: Partial<Record<StatusFilter, number>> = summary
    ? {
        inbox: summary.pending,
        overdue: summary.overdue,
        rescheduled: summary.rescheduled,
        escalated: summary.escalated,
        not_interested: summary.notInterested,
        completed: summary.completed,
        all: summary.total,
      }
    : {}

  const selectedExecutive = useMemo(
    () => performance.find((row) => row.email.toLowerCase() === executiveFilter) || null,
    [performance, executiveFilter],
  )

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

  const dueReminderTasks = useMemo(() => {
    const now = Date.now()
    const seen = typeof window !== 'undefined' ? loadReminderSeen() : new Set<string>()
    return tasks.filter(
      (t) =>
        t.lastUnreachableAt &&
        (t.status === 'pending' || t.status === 'rescheduled') &&
        new Date(t.scheduledAt).getTime() <= now &&
        !seen.has(`${t.id}:${t.lastUnreachableAt}`),
    )
  }, [tasks, reminderTask])

  const dismissReminder = (open: boolean) => {
    if (reminderTask?.lastUnreachableAt) {
      const seen = loadReminderSeen()
      seen.add(`${reminderTask.id}:${reminderTask.lastUnreachableAt}`)
      saveReminderSeen(seen)
    }
    if (open && reminderTask) setExpandedId(reminderTask.id)
    setReminderTask(null)
  }

  const dismissAllReminders = () => {
    const seen = loadReminderSeen()
    for (const t of dueReminderTasks) {
      if (t.lastUnreachableAt) seen.add(`${t.id}:${t.lastUnreachableAt}`)
    }
    saveReminderSeen(seen)
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
                    {performance.map((row) => {
                      const active = executiveFilter === row.email.toLowerCase()
                      return (
                      <tr
                        key={row.email}
                        className={`border-t cursor-pointer transition-colors ${
                          active ? 'bg-purple-500/10' : 'hover:bg-purple-500/[0.04]'
                        }`}
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => selectExecutive(row.email, row.name)}
                        title={active ? 'Click to clear filter' : 'Click to view to-do tasks for this executive'}
                      >
                        <td className="px-4 py-2" style={{ color: 'var(--foreground)' }}>
                          <div className="font-medium flex items-center gap-2">
                            {row.name}
                            {active && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-600 dark:text-purple-300">
                                Viewing
                              </span>
                            )}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>{row.email}</div>
                        </td>
                        <td className="px-3 py-2">{row.assigned}</td>
                        <td className="px-3 py-2">{row.completed}</td>
                        <td className="px-3 py-2">{row.pending}</td>
                        <td className="px-3 py-2 text-red-500">{row.overdue}</td>
                        <td className="px-3 py-2">{row.completionPct}%</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isAdmin && executiveFilter && selectedExecutive && (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                Showing <span className="font-semibold">{selectedExecutive.name}</span>
                {' '}· {selectedExecutive.assigned} tasks · {selectedExecutive.pending} pending · {selectedExecutive.overdue} overdue
              </p>
              <button
                type="button"
                onClick={() => setExecutiveFilter(null)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-purple-500/10 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Clear executive filter
              </button>
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
                  {(escalatedKindCounts[tab.key] || 0) > 0 && (
                    <span className="ml-1 tabular-nums text-red-500 dark:text-red-400">
                      · {escalatedKindCounts[tab.key]} escalated
                    </span>
                  )}
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
          <div ref={taskListRef} className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
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

          {/* Escalated tasks panel — available on every call-type tab */}
          {panelEscalatedTasks.length > 0 && (
            <div
              className="mb-4 rounded-xl border overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <button
                type="button"
                onClick={() => setEscalatedPanelOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-red-500/[0.04] transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                    Escalated tasks
                    <span className="ml-2 tabular-nums text-red-600 dark:text-red-400">
                      {panelEscalatedTasks.length}
                    </span>
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                    {statusFilter === 'escalated'
                      ? 'Full list below — expand any row for details'
                      : 'View escalation reasons for this panel'}
                  </p>
                </div>
                {escalatedPanelOpen ? (
                  <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--foreground-muted)' }} />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--foreground-muted)' }} />
                )}
              </button>
              {escalatedPanelOpen && (
                <div className="border-t divide-y" style={{ borderColor: 'var(--border)' }}>
                  {panelEscalatedTasks.map((task) => {
                    const reason = escalationReason(task)
                    return (
                      <div
                        key={task.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className={badge('red')}>Escalated</span>
                            <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                              {task.orderName}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                              {task.taskLabel}
                            </span>
                          </div>
                          <p className="text-[12px]" style={{ color: 'var(--foreground-muted)' }}>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                              Customer:
                            </span>{' '}
                            {task.customerName}
                            {task.phone ? ` · ${task.phone}` : ''}
                          </p>
                          {task.escalatedTo?.email && (
                            <p className="text-[12px] mt-1" style={{ color: 'var(--foreground-muted)' }}>
                              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                                Escalated to:
                              </span>{' '}
                              {task.escalatedTo.name || task.escalatedTo.email}
                            </p>
                          )}
                          <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--foreground)' }}>
                            <span className="font-semibold">Reason:</span>{' '}
                            {reason || 'No reason recorded'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEscalatedTask(task)}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border"
                          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        >
                          Open task
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

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
                      : statusFilter === 'not_interested'
                        ? 'No not-interested tasks yet.'
                        : 'Nothing for this status yet. Try Generate tasks from COD orders.'}
              </p>
              {!debouncedSearch &&
                statusFilter !== 'rescheduled' &&
                statusFilter !== 'escalated' &&
                statusFilter !== 'not_interested' &&
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
                const taskOrderCtx = orderCtxTaskId === task.id ? orderCtx : null
                const taskOrderCtxLoading = expanded && orderCtxTaskId !== task.id && orderCtxLoading
                const taskOrderCtxError = orderCtxTaskId === task.id ? orderCtxError : null
                const shipState =
                  taskOrderCtx?.state ||
                  taskOrderCtx?.operational?.state ||
                  taskOrderCtx?.order?.state ||
                  null
                const shipCity =
                  taskOrderCtx?.city ||
                  taskOrderCtx?.operational?.city ||
                  taskOrderCtx?.order?.city ||
                  null
                const shipEtd =
                  taskOrderCtx?.etd ||
                  taskOrderCtx?.operational?.etd ||
                  taskOrderCtx?.order?.etd ||
                  null

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
                              {task.priority === 'high' && !isCareTaskCodConfirmed(task) && (
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
                            {expanded && (shipState || shipCity) && (
                              <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                <MapPin className="w-3 h-3" />
                                {[shipCity, shipState].filter(Boolean).join(', ')}
                              </p>
                            )}
                            {expanded && (
                              <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                <Truck className="w-3 h-3" />
                                ETD{' '}
                                {taskOrderCtxLoading
                                  ? '…'
                                  : shipEtd
                                    ? fmtDay(shipEtd)
                                    : '—'}
                              </p>
                            )}
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
                              {task.status === 'escalated' ? 'Escalation reason' : 'Last note'}
                            </p>
                            <p
                              className={`text-[12px] line-clamp-2 ${
                                task.status === 'escalated' ? 'font-medium' : ''
                              }`}
                              style={{
                                color:
                                  task.status === 'escalated'
                                    ? 'var(--foreground)'
                                    : 'var(--foreground-muted)',
                              }}
                            >
                              {task.status === 'escalated'
                                ? escalationReason(task) || 'No reason recorded'
                                : task.notes?.[0]?.text || task.remarks || 'No notes yet'}
                            </p>
                            {task.status === 'escalated' && task.escalatedTo?.email && (
                              <p className="text-[11px] mt-1" style={{ color: 'var(--foreground-muted)' }}>
                                To {task.escalatedTo.name || task.escalatedTo.email}
                              </p>
                            )}
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
                        <span className="text-[10px]" style={{ color: 'var(--foreground-muted)' }}>
                          Tags only — shown on Orders & Order Status
                        </span>
                      </div>
                    )}

                    {expanded && (
                      <div
                        key={`expanded-${task.id}`}
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
                          {task.status === 'escalated' && task.escalatedTo?.email && (
                            <span>
                              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                                Escalated to
                              </span>{' '}
                              {task.escalatedTo.name || task.escalatedTo.email}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last call:{' '}
                            {task.lastCall
                              ? fmtWhen(task.lastCall.startTime || task.lastCall.createdAt)
                              : 'None'}
                          </span>
                          <span>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                              State
                            </span>{' '}
                            {shipState || shipCity
                              ? [shipCity, shipState].filter(Boolean).join(', ')
                              : taskOrderCtxLoading
                                ? '…'
                                : '—'}
                          </span>
                          <span>
                            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                              Est. delivery
                            </span>{' '}
                            {shipEtd
                              ? fmtWhen(shipEtd)
                              : taskOrderCtxLoading
                                ? '…'
                                : 'Not available yet'}
                          </span>
                          {taskOrderCtx?.operational && (
                            <span>
                              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                                Fulfillment
                              </span>{' '}
                              {taskOrderCtx.statusLabel}
                              {taskOrderCtx.operational.awb ? ` · ${taskOrderCtx.operational.awb}` : ''}
                              {taskOrderCtx.operational.courier
                                ? ` · ${taskOrderCtx.operational.courier}`
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
                          {taskOrderCtxLoading && (
                            <p
                              className="text-sm flex items-center gap-2"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              <Loader2 className="w-4 h-4 animate-spin" /> Loading shipment trail…
                            </p>
                          )}
                          {taskOrderCtxError && (
                            <p className="text-sm text-red-500">{taskOrderCtxError}</p>
                          )}
                          {!taskOrderCtxLoading && taskOrderCtx && (
                            <div className="space-y-4">
                              <div>
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                  <p
                                    className="text-xs font-semibold"
                                    style={{ color: 'var(--foreground)' }}
                                  >
                                    {taskOrderCtx.delivered ? 'Order timeline' : 'Shipment timeline'}
                                  </p>
                                  {!taskOrderCtx.delivered && (
                                    <span className={badge('amber')}>
                                      {taskOrderCtx.statusLabel}
                                      {taskOrderCtx.operational?.etd
                                        ? ` · ETD ${fmtDay(taskOrderCtx.operational.etd)}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                                {taskOrderCtx.timeline?.length ? (
                                  <TimelineRail steps={taskOrderCtx.timeline} />
                                ) : (
                                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                                    No timeline steps yet.
                                  </p>
                                )}
                              </div>

                              {(taskOrderCtx.clones?.length > 0 || taskOrderCtx.parent) && (
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
                                            name: (taskOrderCtx.parent || taskOrderCtx.order)?.name,
                                            sub: (taskOrderCtx.parent || taskOrderCtx.order)?.statusLabel,
                                            awb: (taskOrderCtx.parent || taskOrderCtx.order)?.awb,
                                            active: false,
                                          },
                                          ...(taskOrderCtx.clones || []).map(
                                            (clone: any, idx: number) => ({
                                              key: String(clone.id),
                                              title: `Clone${taskOrderCtx.clones.length > 1 ? ` ${idx + 1}` : ''}${
                                                idx === taskOrderCtx.clones.length - 1 ? ' · active' : ''
                                              }`,
                                              name: clone.name,
                                              sub: `${fmtDay(clone.created_at)} · ${clone.statusLabel}`,
                                              awb: clone.awb,
                                              active: idx === taskOrderCtx.clones.length - 1,
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
                        {task.status !== 'completed' && task.status !== 'not_interested' ? (
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
                                  void (async () => {
                                    setEscalateReason('')
                                    const users = await ensureEscalationTargets()
                                    const defaultTarget =
                                      users.find((t) => t.email !== user?.email) || users[0]
                                    setEscalateTargetEmail(defaultTarget?.email || '')
                                    setEscalateConfirmTask(task)
                                  })()
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
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setNotInterestedReason('')
                                  setNotInterestedConfirmTask(task)
                                }}
                                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Not interested
                              </button>
                            </div>

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
                            {task.status === 'not_interested' ? (
                              <>
                                <p className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                                  Not interested
                                </p>
                                <p style={{ color: 'var(--foreground-muted)' }}>
                                  Reason: {task.remarks || '—'}
                                </p>
                                {task.completedAt && (
                                  <p style={{ color: 'var(--foreground-muted)' }}>
                                    Marked on: {fmtWhen(task.completedAt)}
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
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
                              </>
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
                  setEscalateTargetEmail('')
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
            <label className="block mb-3">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Escalate to *
              </span>
              <select
                value={escalateTargetEmail}
                onChange={(e) => setEscalateTargetEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                style={{
                  background: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                {escalationTargets.length === 0 ? (
                  <option value="">No users available</option>
                ) : (
                  escalationTargets.map((t) => (
                    <option key={t.email} value={t.email}>
                      {t.name} ({t.email})
                    </option>
                  ))
                )}
              </select>
            </label>
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
                  setEscalateTargetEmail('')
                }}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  savingId === escalateConfirmTask.id ||
                  !escalateReason.trim() ||
                  !escalateTargetEmail
                }
                onClick={() => onAction(escalateConfirmTask, 'escalate')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Not interested reason popup */}
      {notInterestedConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Not interested
              </h3>
              <button
                type="button"
                onClick={() => {
                  setNotInterestedConfirmTask(null)
                  setNotInterestedReason('')
                }}
                className="p-1 rounded-lg"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--foreground-muted)' }}>
              {notInterestedConfirmTask.orderName} — {notInterestedConfirmTask.taskLabel}
            </p>
            <label className="block mb-4">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Reason *
              </span>
              <textarea
                value={notInterestedReason}
                onChange={(e) => setNotInterestedReason(e.target.value)}
                placeholder="Why is the customer not interested?"
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30 resize-y"
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
                  setNotInterestedConfirmTask(null)
                  setNotInterestedReason('')
                }}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === notInterestedConfirmTask.id || !notInterestedReason.trim()}
                onClick={() => onAction(notInterestedConfirmTask, 'not_interested')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-zinc-700 text-white disabled:opacity-50"
              >
                Move to Not interested
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
                {dueReminderTasks.length > 1 && (
                  <p className="text-[11px] mt-1.5 font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                    {dueReminderTasks.length} reminders waiting
                  </p>
                )}
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
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={dismissAllReminders}
                className="mr-auto px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                title={
                  dueReminderTasks.length > 1
                    ? `Clear all ${dueReminderTasks.length} waiting reminders`
                    : 'Clear this reminder'
                }
              >
                Dismiss all
                {dueReminderTasks.length > 1 ? ` (${dueReminderTasks.length})` : ''}
              </button>
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
