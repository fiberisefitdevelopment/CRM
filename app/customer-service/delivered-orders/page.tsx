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
  PackagePlus,
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
import { OrderIdLink } from '@/components/customer-service/OrderIdLink'
import {
  careOrderWorkspaceHref,
  openCareOrderWorkspace,
} from '@/components/customer-service/careTaskShared'
import {
  CreateShopifyOrderDialog,
  type CreateOrderPrefill,
} from '@/components/customer-service/CreateShopifyOrderDialog'
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
  type DeliveredOrdersDatePreset,
  type DeliveredOrdersPaymentFilter,
  type DeliveredOrdersSort,
  type DeliveredOrdersUpsellFilter,
} from '@/lib/careTasksApi'
import { isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import {
  CALL_AFTER_MAX_MS,
  requiresCustomerRating,
} from '@/src/services/careTasks/types'
import { parseFlexibleDate } from '@/src/utils/orderTimeline'
import type { TimelineStep } from '@/src/utils/orderTimeline'

type MainTab = 'delivered' | 'upsell'
type StatusFilter =
  | 'inbox'
  | 'overdue'
  | 'rescheduled'
  | 'unreachable'
  | 'escalated'
  | 'not_interested'
  | 'completed'
  | 'all'
type PageSize = 20 | 50 | 100
type TaskSort = 'due_asc' | 'due_desc' | 'created_desc' | 'priority' | 'name_asc'
type PackFilter = 'all' | '7' | '30' | '90'

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100]

const ORDER_SORT_OPTIONS: Array<{ value: DeliveredOrdersSort; label: string }> = [
  { value: 'delivered_desc', label: 'Delivered · newest' },
  { value: 'delivered_asc', label: 'Delivered · oldest' },
  { value: 'ordered_desc', label: 'Ordered · newest' },
  { value: 'ordered_asc', label: 'Ordered · oldest' },
  { value: 'total_desc', label: 'Amount · high → low' },
  { value: 'total_asc', label: 'Amount · low → high' },
  { value: 'name_asc', label: 'Order # · A–Z' },
]

const TASK_SORT_OPTIONS: Array<{ value: TaskSort; label: string }> = [
  { value: 'due_asc', label: 'Due · soonest' },
  { value: 'due_desc', label: 'Due · latest' },
  { value: 'created_desc', label: 'Created · newest' },
  { value: 'priority', label: 'Priority · high first' },
  { value: 'name_asc', label: 'Order # · A–Z' },
]

const PACK_FILTERS: Array<{ value: PackFilter; label: string }> = [
  { value: 'all', label: 'All products' },
  { value: '7', label: 'Starter Pack' },
  { value: '30', label: 'Transformation Pack' },
  { value: '90', label: 'Ultimate Pack' },
]

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  customer?: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    phone?: string | null
    address1?: string | null
    address2?: string | null
    city?: string | null
    province?: string | null
    zip?: string | null
    country?: string | null
  } | null
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

  useEffect(() => {
    try {
      const tab = new URLSearchParams(window.location.search).get('tab')
      if (tab === 'upsell') setMainTab('upsell')
    } catch {
      /* ignore */
    }
  }, [])

  const selectMainTab = useCallback((key: MainTab) => {
    setMainTab(key)
    try {
      const url = new URL(window.location.href)
      if (key === 'upsell') url.searchParams.set('tab', 'upsell')
      else url.searchParams.delete('tab')
      window.history.replaceState({}, '', `${url.pathname}${url.search}`)
    } catch {
      /* ignore */
    }
  }, [])

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
  const [upsellFilter, setUpsellFilter] = useState<DeliveredOrdersUpsellFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<DeliveredOrdersPaymentFilter>('all')
  const [datePreset, setDatePreset] = useState<DeliveredOrdersDatePreset>('30days')
  const [orderSort, setOrderSort] = useState<DeliveredOrdersSort>('delivered_desc')
  const [creatingId, setCreatingId] = useState<string | null>(null)

  // Upsell tasks
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox')
  const [packFilter, setPackFilter] = useState<PackFilter>('all')
  const [taskSort, setTaskSort] = useState<TaskSort>('due_asc')
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

  const [createOrderTask, setCreateOrderTask] = useState<CareTask | null>(null)
  const [createOrderPrefill, setCreateOrderPrefill] = useState<CreateOrderPrefill | null>(null)

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
  }, [debouncedOrderSearch, orderPageSize, upsellFilter, paymentFilter, datePreset, orderSort])

  useEffect(() => {
    setTaskPage(1)
  }, [debouncedTaskSearch, statusFilter, packFilter, taskPageSize, taskSort])

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
        upsell: upsellFilter,
        payment: paymentFilter,
        datePreset,
        sort: orderSort,
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
  }, [
    orderPage,
    orderPageSize,
    debouncedOrderSearch,
    upsellFilter,
    paymentFilter,
    datePreset,
    orderSort,
  ])

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
        sort: taskSort,
        deliveredOnly: true,
        pack: packFilter,
      })
      setTasks(data.tasks)
      setTaskTotal(data.total)
      setTaskTotalPages(data.totalPages)
    } catch (err: any) {
      setError(err?.message || 'Failed to load upsell tasks')
    } finally {
      setTasksLoading(false)
    }
  }, [statusFilter, packFilter, debouncedTaskSearch, taskPage, taskPageSize, taskSort])

  useEffect(() => {
    if (mainTab === 'delivered') void loadOrders()
  }, [mainTab, loadOrders])

  useEffect(() => {
    if (mainTab === 'upsell') void loadTasks()
  }, [mainTab, loadTasks])

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

  const openCreateOrderForTask = useCallback(
    (task: CareTask) => {
      const ctx = orderCtxTaskId === task.id ? orderCtx : null
      const c = ctx?.customer
      const nameParts = String(task.customerName || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      setCreateOrderPrefill({
        firstName: c?.firstName || nameParts[0] || '',
        lastName: c?.lastName || nameParts.slice(1).join(' ') || '',
        email: c?.email || null,
        phone: c?.phone || task.phone || null,
        address1: c?.address1 || null,
        address2: c?.address2 || null,
        city: c?.city || ctx?.city || null,
        province: c?.province || ctx?.state || null,
        zip: c?.zip || ctx?.pincode || null,
        country: c?.country || 'India',
        sourceOrderName: task.orderName || null,
        note: `Upsell from ${task.taskLabel || 'care task'} · ${task.orderName || task.orderId}`,
      })
      setCreateOrderTask(task)
    },
    [orderCtx, orderCtxTaskId],
  )

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
      const taskId = result.task?.id || order.upsellTaskId
      if (taskId) openCareOrderWorkspace(order.id, taskId, 'delivered-upsell')
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
        setStatusFilter('unreachable')
        setSuccess('Marked unreachable')
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
        setStatusFilter('rescheduled')
        setSuccess('Scheduled call after — moved to Rescheduled tab')
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
        setStatusFilter('rescheduled')
        setSuccess('Rescheduled — moved to Rescheduled tab')
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
    ['unreachable', 'Unreachable'],
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
                      <button
                        type="button"
                        onClick={() => {
                          selectMainTab('delivered')
                          setUpsellFilter('all')
                        }}
                        className={`text-left ${upsellFilter === 'all' && mainTab === 'delivered' ? 'underline decoration-2' : ''}`}
                      >
                        <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--foreground)' }}>
                          {orderSummary.delivered.toLocaleString('en-IN')}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          selectMainTab('delivered')
                          setUpsellFilter('open')
                        }}
                        className={`text-left ${upsellFilter === 'open' ? 'underline decoration-2' : ''}`}
                      >
                        <span className="text-xl font-bold tabular-nums text-purple-600 dark:text-purple-300">
                          {orderSummary.openUpsell.toLocaleString('en-IN')}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          selectMainTab('delivered')
                          setUpsellFilter('needs')
                        }}
                        className={`text-left ${upsellFilter === 'needs' ? 'underline decoration-2' : ''}`}
                      >
                        <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                          {orderSummary.needsUpsell.toLocaleString('en-IN')}
                        </span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className="px-4 py-2 text-[11px] border-t"
              style={{ color: 'var(--foreground-muted)', borderColor: 'var(--border)' }}
            >
              {datePreset === 'all'
                ? 'All time'
                : datePreset === '7days'
                  ? 'Last 7 days'
                  : datePreset === '90days'
                    ? 'Last 90 days'
                    : 'Last 30 days'}
              {isExec
                ? ' · your assigned orders (÷2 with the other care executive)'
                : ' · all care assignments'}
              {' · '}
              click a count to filter · counts update with search / payment
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
                onClick={() => selectMainTab(key)}
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
              <div className="mb-4 space-y-3">
                <div className="relative">
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

                <div className="flex flex-wrap gap-2 items-center">
                  {(
                    [
                      ['all', 'All'],
                      ['needs', 'Needs upsell'],
                      ['open', 'Open upsell'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setUpsellFilter(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        upsellFilter === key ? 'bg-purple-600 text-white border-purple-500' : ''
                      }`}
                      style={
                        upsellFilter === key
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

                  <span className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />

                  {(
                    [
                      ['all', 'All pay'],
                      ['cod', 'COD'],
                      ['prepaid', 'Prepaid'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPaymentFilter(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        paymentFilter === key ? 'bg-purple-600 text-white border-purple-500' : ''
                      }`}
                      style={
                        paymentFilter === key
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

                <div className="flex flex-wrap gap-2 items-center">
                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Period
                    <select
                      value={datePreset}
                      onChange={(e) => setDatePreset(e.target.value as DeliveredOrdersDatePreset)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold"
                      style={{
                        background: 'var(--card)',
                        borderColor: 'var(--border)',
                        color: 'var(--foreground)',
                      }}
                    >
                      <option value="7days">Last 7 days</option>
                      <option value="30days">Last 30 days</option>
                      <option value="90days">Last 90 days</option>
                      <option value="all">All time</option>
                    </select>
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Sort
                    <select
                      value={orderSort}
                      onChange={(e) => setOrderSort(e.target.value as DeliveredOrdersSort)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold"
                      style={{
                        background: 'var(--card)',
                        borderColor: 'var(--border)',
                        color: 'var(--foreground)',
                      }}
                    >
                      {ORDER_SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(upsellFilter !== 'all' ||
                    paymentFilter !== 'all' ||
                    datePreset !== '30days' ||
                    orderSort !== 'delivered_desc' ||
                    orderSearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        setUpsellFilter('all')
                        setPaymentFilter('all')
                        setDatePreset('30days')
                        setOrderSort('delivered_desc')
                        setOrderSearch('')
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{
                        borderColor: 'var(--border)',
                        color: 'var(--foreground-muted)',
                        background: 'var(--card)',
                      }}
                    >
                      Reset filters
                    </button>
                  )}
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
                              <OrderIdLink orderId={order.id} orderName={order.name} />
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
                              <a
                                href={careOrderWorkspaceHref(
                                  order.id,
                                  order.upsellTaskId || undefined,
                                  'delivered',
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-2 rounded-lg text-sm font-medium border no-underline"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                Open care workspace
                              </a>
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

              <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="relative flex-1">
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
                <label className="inline-flex items-center gap-2 text-xs shrink-0" style={{ color: 'var(--foreground-muted)' }}>
                  Product
                  <select
                    value={packFilter}
                    onChange={(e) => setPackFilter(e.target.value as PackFilter)}
                    className="px-2.5 py-2 rounded-xl border text-xs font-semibold"
                    style={{
                      background: 'var(--card)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    {PACK_FILTERS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-xs shrink-0" style={{ color: 'var(--foreground-muted)' }}>
                  Sort
                  <select
                    value={taskSort}
                    onChange={(e) => setTaskSort(e.target.value as TaskSort)}
                    className="px-2.5 py-2 rounded-xl border text-xs font-semibold"
                    style={{
                      background: 'var(--card)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    {TASK_SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
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
                  No upsell tasks for delivered orders in this filter.
                  <span className="block mt-1 text-[11px]">
                    Click a row to open the shared care workspace (call journey, trails, notes). Pack schedule: Starter D3/D5 · Transformation D15/D23 · Ultimate D15/D30/D60.
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => {
                    const st = statusBadge(task)
                    const overdue = isTaskOverdue(task)
                    const workspaceHref = careOrderWorkspaceHref(
                      task.orderId,
                      task.id,
                      'delivered-upsell',
                    )
                    return (
                      <a
                        key={task.id}
                        href={workspaceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`crm-card overflow-hidden border cursor-pointer hover:border-purple-500/40 transition-colors block no-underline ${
                          overdue ? 'ring-1 ring-red-500/35' : ''
                        }`}
                        style={{
                          borderColor: overdue ? 'rgba(239, 68, 68, 0.45)' : 'var(--border)',
                          color: 'inherit',
                        }}
                        title="Open care workspace in a new tab"
                      >
                        <div className="w-full text-left p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-3">
                              <div className="md:col-span-4">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span className={badge('purple')}>Upsell</span>
                                  <span className={badge(st.tone)}>{st.label}</span>
                                  {task.priority === 'high' && <span className={badge('red')}>High</span>}
                                  {task.packLabel && <span className={badge('blue')}>{task.packLabel}</span>}
                                </div>
                                <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                                  {task.taskLabel}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                  <span className="text-purple-600 font-medium">
                                    {task.orderName || `#${task.orderId}`}
                                  </span>
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
                        </div>
                      </a>
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
              We’ll move <span className="font-semibold">{unreachableConfirmTask.orderName}</span> to
              the Unreachable tab. It will not return to To do.
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

      <CreateShopifyOrderDialog
        open={Boolean(createOrderTask)}
        onClose={() => {
          setCreateOrderTask(null)
          setCreateOrderPrefill(null)
        }}
        prefill={createOrderPrefill}
        agent={{ name: user?.name, email: user?.email }}
        onCreated={async (result) => {
          const agentName =
            result.createdBy?.name || user?.name || user?.email?.split('@')[0] || 'Care agent'
          const agentEmail = result.createdBy?.email || user?.email || ''
          setSuccess(
            `${result.orderName || 'Order'} created on Shopify by ${agentName}${
              agentEmail ? ` (${agentEmail})` : ''
            }`,
          )
          if (createOrderTask?.id && result.orderName) {
            try {
              const updated = await addCareTaskNote(
                createOrderTask.id,
                `Shopify order ${result.orderName} created by ${agentName}${
                  agentEmail ? ` (${agentEmail})` : ''
                }`,
              )
              setTasks((prev) =>
                prev.map((t) => (t.id === createOrderTask.id ? updated : t)),
              )
            } catch {
              // note is best-effort
            }
          }
        }}
      />

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
