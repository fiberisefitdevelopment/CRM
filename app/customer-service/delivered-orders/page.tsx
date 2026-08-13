'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Star,
  Truck,
  User,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { ErrorToast } from '@/components/ErrorToast'
import {
  addCareTaskNote,
  createUpsellCareTask,
  getCareOrderContext,
  getEscalationTargets,
  listCareTasks,
  listDeliveredOrdersForCare,
  updateCareTask,
  type CareTask,
  type DeliveredOrderForCare,
  type DeliveredOrdersCareSummary,
} from '@/lib/careTasksApi'
import { isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import {
  CALL_AFTER_MAX_MS,
  requiresCustomerRating,
} from '@/src/services/careTasks/types'
import type { TimelineStep } from '@/src/utils/orderTimeline'

type MainTab = 'delivered' | 'upsell'
type StatusFilter =
  | 'inbox'
  | 'overdue'
  | 'rescheduled'
  | 'escalated'
  | 'not_interested'
  | 'completed'
  | 'all'
type PageSize = 20 | 50 | 100

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100]

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  if (task.status === 'rescheduled') return { label: 'Call after', tone: 'blue' as const }
  if (isTaskOverdue(task)) return { label: 'Overdue', tone: 'red' as const }
  return { label: 'To do', tone: 'purple' as const }
}

function escalationReason(task: CareTask) {
  return task.remarks || task.notes?.[0]?.text || ''
}

function customerLabel(order: DeliveredOrderForCare) {
  const c = order.customer
  const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
  return name || c?.email || '—'
}

function phoneLabel(order: DeliveredOrderForCare) {
  return order.customer?.phone || order.shipping_address?.phone || '—'
}

export default function DeliveredOrdersPage() {
  const { user } = useAuth()
  const role = user?.role
  const isExec = isCareExecutiveRole(role)

  const [mainTab, setMainTab] = useState<MainTab>('delivered')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Delivered queue
  const [orders, setOrders] = useState<DeliveredOrderForCare[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [orderSearch, setOrderSearch] = useState('')
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState('')
  const [orderPage, setOrderPage] = useState(1)
  const [orderPageSize, setOrderPageSize] = useState<PageSize>(20)
  const [orderTotal, setOrderTotal] = useState(0)
  const [orderTotalPages, setOrderTotalPages] = useState(1)
  const [orderSummary, setOrderSummary] = useState<DeliveredOrdersCareSummary>({
    delivered: 0,
    openUpsell: 0,
    needsUpsell: 0,
  })
  const [creatingId, setCreatingId] = useState<string | null>(null)

  // Upsell tasks
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox')
  const [taskSearch, setTaskSearch] = useState('')
  const [debouncedTaskSearch, setDebouncedTaskSearch] = useState('')
  const [taskPage, setTaskPage] = useState(1)
  const [taskPageSize, setTaskPageSize] = useState<PageSize>(20)
  const [taskTotal, setTaskTotal] = useState(0)
  const [taskTotalPages, setTaskTotalPages] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [outcome, setOutcome] = useState('')
  const [remarks, setRemarks] = useState('')
  const [customerResponse, setCustomerResponse] = useState('')
  const [customerRating, setCustomerRating] = useState(0)
  const [rescheduleAt, setRescheduleAt] = useState('')
  const [callAfterAt, setCallAfterAt] = useState('')
  const [escalateReason, setEscalateReason] = useState('')
  const [escalateTargetEmail, setEscalateTargetEmail] = useState('')
  const [notInterestedReason, setNotInterestedReason] = useState('')
  const [noteText, setNoteText] = useState('')
  const [escalationTargets, setEscalationTargets] = useState<
    Array<{ userId: string; email: string; name: string }>
  >([])

  const [unreachableConfirmTask, setUnreachableConfirmTask] = useState<CareTask | null>(null)
  const [escalateConfirmTask, setEscalateConfirmTask] = useState<CareTask | null>(null)
  const [callAfterConfirmTask, setCallAfterConfirmTask] = useState<CareTask | null>(null)
  const [notInterestedConfirmTask, setNotInterestedConfirmTask] = useState<CareTask | null>(null)

  const [orderCtx, setOrderCtx] = useState<OrderContext | null>(null)
  const [orderCtxLoading, setOrderCtxLoading] = useState(false)
  const [orderCtxError, setOrderCtxError] = useState<string | null>(null)
  const [orderCtxTaskId, setOrderCtxTaskId] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300)
    return () => window.clearTimeout(t)
  }, [orderSearch])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedTaskSearch(taskSearch.trim()), 300)
    return () => window.clearTimeout(t)
  }, [taskSearch])

  useEffect(() => {
    setOrderPage(1)
  }, [debouncedOrderSearch, orderPageSize])

  useEffect(() => {
    setTaskPage(1)
  }, [debouncedTaskSearch, statusFilter, taskPageSize])

  const clearExpandedTaskUi = useCallback(() => {
    setOutcome('')
    setRemarks('')
    setCustomerResponse('')
    setCustomerRating(0)
    setRescheduleAt('')
    setCallAfterAt('')
    setEscalateReason('')
    setEscalateTargetEmail('')
    setNotInterestedReason('')
    setNoteText('')
    setOrderCtx(null)
    setOrderCtxError(null)
    setOrderCtxTaskId(null)
  }, [])

  const loadOrders = useCallback(async () => {
    try {
      setOrdersLoading(true)
      setError(null)
      const data = await listDeliveredOrdersForCare({
        page: orderPage,
        pageSize: orderPageSize,
        search: debouncedOrderSearch || undefined,
      })
      setOrders(data.orders)
      setOrderTotal(data.pagination.total)
      setOrderTotalPages(data.pagination.totalPages)
      setOrderSummary(data.summary)
    } catch (err: any) {
      setError(err?.message || 'Failed to load delivered orders')
    } finally {
      setOrdersLoading(false)
    }
  }, [orderPage, orderPageSize, debouncedOrderSearch])

  const loadTasks = useCallback(async () => {
    try {
      setTasksLoading(true)
      setError(null)
      const data = await listCareTasks({
        status: statusFilter,
        kind: 'upsell',
        search: debouncedTaskSearch || undefined,
        page: taskPage,
        pageSize: taskPageSize,
      })
      setTasks(data.tasks)
      setTaskTotal(data.total)
      setTaskTotalPages(data.totalPages)
    } catch (err: any) {
      setError(err?.message || 'Failed to load upsell tasks')
    } finally {
      setTasksLoading(false)
    }
  }, [statusFilter, debouncedTaskSearch, taskPage, taskPageSize])

  useEffect(() => {
    if (mainTab === 'delivered') void loadOrders()
  }, [mainTab, loadOrders])

  useEffect(() => {
    if (mainTab === 'upsell') void loadTasks()
  }, [mainTab, loadTasks])

  useEffect(() => {
    void getEscalationTargets()
      .then(setEscalationTargets)
      .catch(() => setEscalationTargets([]))
  }, [])

  const expandedTask = useMemo(
    () => tasks.find((t) => t.id === expandedId) || null,
    [tasks, expandedId],
  )

  useEffect(() => {
    if (!expandedTask) return
    clearExpandedTaskUi()
    const taskId = expandedTask.id
    const { orderId, orderName } = expandedTask
    let cancelled = false
    ;(async () => {
      try {
        setOrderCtxLoading(true)
        setOrderCtxError(null)
        const ctx = await getCareOrderContext(orderId, orderName)
        if (cancelled) return
        setOrderCtx(ctx)
        setOrderCtxTaskId(taskId)
      } catch (err: any) {
        if (cancelled) return
        setOrderCtxError(err?.message || 'Failed to load order trail')
        setOrderCtxTaskId(taskId)
      } finally {
        if (!cancelled) setOrderCtxLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expandedId, expandedTask?.id, expandedTask?.orderId, expandedTask?.orderName, clearExpandedTaskUi])

  const onCreateUpsell = async (order: DeliveredOrderForCare) => {
    const id = String(order.id)
    try {
      setCreatingId(id)
      setError(null)
      setSuccess(null)
      const result = await createUpsellCareTask(order.id, order.name)
      if (result.created) {
        setSuccess(`Upsell Call created for ${order.name}`)
      } else if (result.task && ['completed', 'not_interested'].includes(result.task.status)) {
        setSuccess(`Upsell Call already finished for ${order.name} (not reopened)`)
      } else {
        setSuccess(`Open Upsell Call already exists for ${order.name}`)
      }
      await loadOrders()
    } catch (err: any) {
      setError(err?.message || 'Failed to create upsell task')
    } finally {
      setCreatingId(null)
    }
  }

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
      if (action === 'complete') {
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
        await updateCareTask(task.id, {
          action: 'reschedule',
          scheduledAt: new Date(form.rescheduleAt).toISOString(),
          remarks: form.remarks,
        })
        setSuccess('Rescheduled')
      }
      await loadTasks()
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
      await loadTasks()
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

  const callAfterMin = toDatetimeLocalValue(new Date())
  const callAfterMax = toDatetimeLocalValue(new Date(Date.now() + CALL_AFTER_MAX_MS))

  const safeOrderPage = Math.min(orderPage, Math.max(1, orderTotalPages))
  const safeTaskPage = Math.min(taskPage, Math.max(1, taskTotalPages))
  const orderStart = (safeOrderPage - 1) * orderPageSize
  const orderEnd = Math.min(orderStart + orders.length, orderTotal)
  const taskStart = (safeTaskPage - 1) * taskPageSize
  const taskEnd = Math.min(taskStart + tasks.length, taskTotal)

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-6xl mx-auto mt-20">
          {!isExec && <SubNav />}

          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
                Delivered Orders
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                Create Upsell Call tasks from delivered orders and work them here.
              </p>
            </div>
            <button
              onClick={() => (mainTab === 'delivered' ? loadOrders() : loadTasks())}
              disabled={ordersLoading || tasksLoading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border disabled:opacity-50"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
                background: 'var(--card)',
              }}
            >
              <RefreshCw
                className={`w-4 h-4 ${ordersLoading || tasksLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </div>

          <div
            className="mb-5 rounded-xl border overflow-hidden"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[11px] uppercase tracking-wider border-b"
                    style={{ color: 'var(--foreground-muted)', borderColor: 'var(--border)' }}
                  >
                    <th className="px-4 py-2.5 font-semibold">Delivered</th>
                    <th className="px-4 py-2.5 font-semibold">Open upsell</th>
                    <th className="px-4 py-2.5 font-semibold">Needs upsell</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-3">
                      <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--foreground)' }}>
                        {orderSummary.delivered.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xl font-bold tabular-nums text-purple-600 dark:text-purple-300">
                        {orderSummary.openUpsell.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                        {orderSummary.needsUpsell.toLocaleString('en-IN')}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className="px-4 py-2 text-[11px] border-t"
              style={{ color: 'var(--foreground-muted)', borderColor: 'var(--border)' }}
            >
              Last 30 days
              {isExec
                ? ' · your assigned orders (÷2 with the other care executive)'
                : ' · all care assignments'}
              {' · '}
              counts update with search
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(
              [
                ['delivered', 'Delivered queue', PackageCheck],
                ['upsell', 'Upsell tasks', Phone],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMainTab(key)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  mainTab === key
                    ? 'bg-purple-600 text-white border-purple-500'
                    : 'border-[var(--border)]'
                }`}
                style={
                  mainTab === key
                    ? undefined
                    : { color: 'var(--foreground)', background: 'var(--card)' }
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {mainTab === 'delivered' && (
            <>
              <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="relative flex-1">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--foreground-muted)' }}
                  />
                  <input
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search order #, customer, phone…"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                    style={{
                      background: 'var(--card)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  />
                </div>
              </div>

              {ordersLoading && !orders.length ? (
                <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--foreground-muted)' }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading delivered orders…
                </div>
              ) : orders.length === 0 ? (
                <div
                  className="rounded-xl border p-8 text-center text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--card)' }}
                >
                  No delivered orders found.
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => {
                    const id = String(order.id)
                    const busy = creatingId === id
                    return (
                      <div
                        key={id}
                        className="crm-card border p-4"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                          <div className="md:col-span-4">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className={badge('emerald')}>Delivered</span>
                              {order.hasOpenUpsell && (
                                <span className={badge('purple')}>Open upsell</span>
                              )}
                              {order.care_tag?.label && (
                                <span className={badge('blue')}>{String(order.care_tag.label)}</span>
                              )}
                            </div>
                            <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                              {order.name}
                            </p>
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              Ordered {fmtDay(order.created_at)}
                              {order.delivered_at ? ` · delivered ${fmtDay(order.delivered_at)}` : ''}
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
                              {customerLabel(order)}
                            </p>
                            <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              <Phone className="w-3 h-3" />
                              {phoneLabel(order)}
                            </p>
                            {(order.shipping_address?.city || order.shipping_address?.province) && (
                              <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                <MapPin className="w-3 h-3" />
                                {[order.shipping_address?.city, order.shipping_address?.province]
                                  .filter(Boolean)
                                  .join(', ')}
                              </p>
                            )}
                          </div>

                          <div className="md:col-span-2">
                            <p
                              className="text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              Total
                            </p>
                            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                              {order.currency || 'INR'} {order.total_price}
                            </p>
                            {order.care_executive?.name || order.care_executive?.email ? (
                              <p className="text-[11px] mt-1" style={{ color: 'var(--foreground-muted)' }}>
                                Assignee: {order.care_executive?.name || order.care_executive?.email}
                              </p>
                            ) : null}
                          </div>

                          <div className="md:col-span-3 flex md:justify-end items-center gap-2">
                            {order.hasOpenUpsell ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setMainTab('upsell')
                                  setStatusFilter('inbox')
                                  setTaskSearch(order.name || '')
                                }}
                                className="px-3 py-2 rounded-lg text-sm font-medium border"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                View upsell task
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onCreateUpsell(order)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
                              >
                                {busy ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <PackageCheck className="w-4 h-4" />
                                )}
                                Create Upsell Task
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div
                className="sticky bottom-3 z-10 mt-4 rounded-xl border p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  {orderTotal === 0
                    ? 'No results'
                    : `${orderStart + 1}–${orderEnd} of ${orderTotal.toLocaleString('en-IN')}`}
                </p>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Per page
                    <select
                      value={orderPageSize}
                      onChange={(e) => setOrderPageSize(Number(e.target.value) as PageSize)}
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
                  <button
                    type="button"
                    disabled={safeOrderPage <= 1 || ordersLoading}
                    onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                    className="p-2 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
                    {safeOrderPage}/{Math.max(1, orderTotalPages)}
                  </span>
                  <button
                    type="button"
                    disabled={safeOrderPage >= orderTotalPages || ordersLoading}
                    onClick={() => setOrderPage((p) => p + 1)}
                    className="p-2 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}

          {mainTab === 'upsell' && (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {statusFilters.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                      statusFilter === key
                        ? 'bg-purple-600 text-white border-purple-500'
                        : ''
                    }`}
                    style={
                      statusFilter === key
                        ? undefined
                        : {
                            borderColor: 'var(--border)',
                            color: 'var(--foreground)',
                            background: 'var(--card)',
                          }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-4 relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: 'var(--foreground-muted)' }}
                />
                <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search upsell tasks…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>

              {tasksLoading && !tasks.length ? (
                <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--foreground-muted)' }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading upsell tasks…
                </div>
              ) : tasks.length === 0 ? (
                <div
                  className="rounded-xl border p-8 text-center text-sm"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--card)' }}
                >
                  No upsell tasks in this filter.
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => {
                    const expanded = expandedId === task.id
                    const st = statusBadge(task)
                    const overdue = isTaskOverdue(task)
                    const busy = savingId === task.id
                    const canAct = !['completed', 'not_interested'].includes(task.status)
                    const taskOrderCtx = orderCtxTaskId === task.id ? orderCtx : null
                    const taskOrderCtxLoading = expanded && orderCtxTaskId !== task.id && orderCtxLoading
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
                                  <span className={badge('purple')}>Upsell</span>
                                  <span className={badge(st.tone)}>{st.label}</span>
                                  {task.priority === 'high' && <span className={badge('red')}>High</span>}
                                </div>
                                <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                                  {task.taskLabel}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                  {task.orderName}
                                  {task.packLabel ? ` · ${task.packLabel}` : ''}
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
                                    ETD {taskOrderCtxLoading ? '…' : shipEtd ? fmtDay(shipEtd) : '—'}
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
                                <p className="text-[12px] line-clamp-2" style={{ color: 'var(--foreground-muted)' }}>
                                  {task.status === 'escalated'
                                    ? escalationReason(task) || 'No reason recorded'
                                    : task.notes?.[0]?.text || task.remarks || 'No notes yet'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </button>

                        {expanded && (
                          <div className="px-4 pb-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                            {(taskOrderCtx?.timeline?.length || orderCtxLoading || orderCtxError) && (
                              <div
                                className="rounded-xl border p-3"
                                style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
                              >
                                <p
                                  className="text-[10px] font-bold uppercase tracking-wider mb-2"
                                  style={{ color: 'var(--foreground-muted)' }}
                                >
                                  Order trail
                                </p>
                                {orderCtxLoading && orderCtxTaskId !== task.id ? (
                                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                                    Loading trail…
                                  </p>
                                ) : orderCtxError && orderCtxTaskId === task.id ? (
                                  <p className="text-xs text-red-500">{orderCtxError}</p>
                                ) : taskOrderCtx?.timeline?.length ? (
                                  <TimelineRail steps={taskOrderCtx.timeline} />
                                ) : null}
                              </div>
                            )}

                            {canAct ? (
                              <div className="space-y-3 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <label className="block">
                                    <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                                      Call outcome
                                    </span>
                                    <input
                                      value={outcome}
                                      onChange={(e) => setOutcome(e.target.value)}
                                      placeholder="e.g. Interested in refill"
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
                                      placeholder="e.g. Will reorder next week"
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
                                </div>

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
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
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
                                      const defaultTarget =
                                        escalationTargets.find((t) => t.email !== user?.email) ||
                                        escalationTargets[0]
                                      setEscalateTargetEmail(defaultTarget?.email || '')
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
                                      setCallAfterAt(
                                        toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
                                      )
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

                                <div className="flex flex-wrap items-end gap-2">
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

                                <div className="flex gap-2">
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
                                    <p className="font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                                      Not interested
                                    </p>
                                    <p style={{ color: 'var(--foreground-muted)' }}>
                                      Reason: {task.remarks || '—'}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                      <CheckCircle2 className="w-4 h-4" /> Completed
                                    </p>
                                    <p style={{ color: 'var(--foreground-muted)' }}>
                                      Outcome: {task.outcome || '—'}
                                    </p>
                                    <p style={{ color: 'var(--foreground-muted)' }}>
                                      Response: {task.customerResponse || '—'}
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div
                className="sticky bottom-3 z-10 mt-4 rounded-xl border p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  {taskTotal === 0
                    ? 'No results'
                    : `${taskStart + 1}–${taskEnd} of ${taskTotal.toLocaleString('en-IN')}`}
                </p>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Per page
                    <select
                      value={taskPageSize}
                      onChange={(e) => setTaskPageSize(Number(e.target.value) as PageSize)}
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
                  <button
                    type="button"
                    disabled={safeTaskPage <= 1 || tasksLoading}
                    onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
                    className="p-2 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
                    {safeTaskPage}/{Math.max(1, taskTotalPages)}
                  </span>
                  <button
                    type="button"
                    disabled={safeTaskPage >= taskTotalPages || tasksLoading}
                    onClick={() => setTaskPage((p) => p + 1)}
                    className="p-2 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {unreachableConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
              Customer unreachable
            </h3>
            <p className="text-sm mt-2" style={{ color: 'var(--foreground-muted)' }}>
              We’ll bring <span className="font-semibold">{unreachableConfirmTask.orderName}</span> back
              in about an hour.
            </p>
            <div className="mt-4 flex justify-end gap-2">
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
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white disabled:opacity-50"
              >
                Mark unreachable
              </button>
            </div>
          </div>
        </div>
      )}

      {escalateConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
              Escalate task
            </h3>
            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              {escalateConfirmTask.orderName} — {escalateConfirmTask.taskLabel}
            </p>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Escalate to
              </span>
              <select
                value={escalateTargetEmail}
                onChange={(e) => setEscalateTargetEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm border"
                style={{
                  background: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <option value="">Select…</option>
                {escalationTargets.map((t) => (
                  <option key={t.email} value={t.email}>
                    {t.name || t.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                Reason
              </span>
              <textarea
                value={escalateReason}
                onChange={(e) => setEscalateReason(e.target.value)}
                rows={3}
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
                onClick={() => setEscalateConfirmTask(null)}
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
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          </div>
        </div>
      )}

      {notInterestedConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
              Not interested
            </h3>
            <textarea
              value={notInterestedReason}
              onChange={(e) => setNotInterestedReason(e.target.value)}
              rows={3}
              placeholder="Why is the customer not interested?"
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{
                background: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotInterestedConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === notInterestedConfirmTask.id || !notInterestedReason.trim()}
                onClick={() => onAction(notInterestedConfirmTask, 'not_interested')}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
              >
                Move to Not interested
              </button>
            </div>
          </div>
        </div>
      )}

      {callAfterConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
              Call After
            </h3>
            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              {callAfterConfirmTask.orderName} — schedule a callback within 3 days.
            </p>
            <input
              type="datetime-local"
              value={callAfterAt}
              min={callAfterMin}
              max={callAfterMax}
              onChange={(e) => setCallAfterAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{
                background: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCallAfterConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === callAfterConfirmTask.id || !callAfterAt}
                onClick={() => onAction(callAfterConfirmTask, 'call_after')}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white disabled:opacity-50"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 text-sm">
          {success}
          <button className="ml-2 opacity-60" onClick={() => setSuccess(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
