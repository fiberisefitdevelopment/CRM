'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Headphones,
  Loader2,
  MapPin,
  PackagePlus,
  Phone,
  Star,
  StickyNote,
  Truck,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { CallAudioPlayer } from '@/components/customer-service/CallAudioPlayer'
import { OrderIdLink } from '@/components/customer-service/OrderIdLink'
import { ErrorToast } from '@/components/ErrorToast'
import {
  CreateShopifyOrderDialog,
  type CreateOrderPrefill,
} from '@/components/customer-service/CreateShopifyOrderDialog'
import {
  badge,
  buildCareOrderActivity,
  careOrderWorkspaceHref,
  careWorkspaceBackLink,
  escalationReason,
  fmtDay,
  fmtWhen,
  statusBadge,
  TimelineRail,
  toDatetimeLocalValue,
  type OrderContext,
} from '@/components/customer-service/careTaskShared'
import {
  addCareTaskNote,
  getCareOrderActivity,
  getCareOrderContext,
  getCareTask,
  getDeviceRecordingStreamUrl,
  getEscalationTargets,
  listCareTasks,
  listDeviceCareRecordings,
  updateCareTask,
  type CareTask,
  type DeviceCallRecording,
} from '@/lib/careTasksApi'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import {
  CALL_AFTER_MAX_MS,
  getCareTaskKind,
  requiresCustomerRating,
} from '@/src/services/careTasks/types'
import { isCareTaskCodConfirmed } from '@/src/utils/careOrderTags'

function sortCallJourney(list: CareTask[]): CareTask[] {
  return [...list].sort((a, b) => {
    const da = Number(a.scheduleDay)
    const db = Number(b.scheduleDay)
    const sa = Number.isFinite(da) ? da : 999
    const sb = Number.isFinite(db) ? db : 999
    if (sa !== sb) return sa - sb
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  })
}

export default function CareOrderWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
          <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
        </div>
      }
    >
      <CareOrderWorkspaceInner />
    </Suspense>
  )
}

function CareOrderWorkspaceInner() {
  const { user } = useAuth()
  const params = useParams()
  const searchParams = useSearchParams()
  const orderId = String(params?.orderId || '').trim()
  const taskFromQuery = searchParams.get('task') || ''
  const fromQuery = searchParams.get('from') || ''
  const backLink = careWorkspaceBackLink(fromQuery)

  const isAdmin = isAdminRole(user?.role)
  const isExec = isCareExecutiveRole(user?.role)

  const [tasks, setTasks] = useState<CareTask[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(taskFromQuery || null)
  const [orderCtx, setOrderCtx] = useState<OrderContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [orderCtxLoading, setOrderCtxLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderCtxError, setOrderCtxError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

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
  /** Quick actions from Call Journey cards */
  const [crossReasonTask, setCrossReasonTask] = useState<CareTask | null>(null)
  const [crossReason, setCrossReason] = useState('')
  const [approveTask, setApproveTask] = useState<CareTask | null>(null)
  const [approveRating, setApproveRating] = useState(0)
  const [noteOpenTaskId, setNoteOpenTaskId] = useState<string | null>(null)
  const [journeyNoteText, setJourneyNoteText] = useState('')
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [createOrderPrefill, setCreateOrderPrefill] = useState<CreateOrderPrefill | null>(null)
  const [activityLogs, setActivityLogs] = useState<
    Array<{
      id: string
      action: string
      taskId?: string | null
      details?: Record<string, unknown>
      createdAt?: string | null
    }>
  >([])
  const [deviceRecordings, setDeviceRecordings] = useState<DeviceCallRecording[]>([])
  const [recordingsLoading, setRecordingsLoading] = useState(false)

  const journey = useMemo(() => sortCallJourney(tasks), [tasks])

  const activityItems = useMemo(
    () => buildCareOrderActivity(tasks, activityLogs),
    [tasks, activityLogs],
  )

  const task = useMemo(() => {
    if (!journey.length) return null
    return (
      journey.find((t) => t.id === activeTaskId) ||
      journey.find((t) => t.status === 'pending' || t.status === 'rescheduled') ||
      journey[0]
    )
  }, [journey, activeTaskId])

  const customerPhone = task?.phone || tasks[0]?.phone || ''

  useEffect(() => {
    if (!customerPhone) {
      setDeviceRecordings([])
      return
    }
    let cancelled = false
    setRecordingsLoading(true)
    listDeviceCareRecordings(customerPhone, orderId)
      .then((rows) => {
        if (!cancelled) setDeviceRecordings(rows)
      })
      .catch(() => {
        if (!cancelled) setDeviceRecordings([])
      })
      .finally(() => {
        if (!cancelled) setRecordingsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerPhone, orderId])

  const latestDeviceCallAt = deviceRecordings[0]?.createdAt || null

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    setError(null)
    try {
      let seed: CareTask | null = null
      if (taskFromQuery) {
        try {
          seed = await getCareTask(taskFromQuery)
        } catch {
          seed = null
        }
      }

      const search = seed?.orderName || orderId
      const listRes = await listCareTasks({
        status: 'all',
        kind: 'all',
        search,
        page: 1,
        pageSize: 100,
        groupBy: 'order',
      })

      const matched =
        listRes.groups?.find((g) => String(g.orderId) === String(orderId)) ||
        listRes.groups?.find((g) =>
          g.tasks.some((t) => String(t.orderId) === String(orderId) || t.id === taskFromQuery),
        ) ||
        null

      let nextTasks = matched?.tasks?.length
        ? matched.tasks
        : listRes.tasks.filter(
            (t) => String(t.orderId) === String(orderId) || t.id === taskFromQuery,
          )

      if (!nextTasks.length && seed) nextTasks = [seed]
      nextTasks = sortCallJourney(nextTasks)
      setTasks(nextTasks)

      try {
        const logs = await getCareOrderActivity(
          orderId,
          nextTasks.map((t) => t.id),
        )
        setActivityLogs(logs)
      } catch {
        setActivityLogs([])
      }

      const focusId =
        taskFromQuery ||
        matched?.focusTaskId ||
        nextTasks.find((t) => t.status === 'pending' || t.status === 'rescheduled')?.id ||
        nextTasks[0]?.id ||
        null
      setActiveTaskId(focusId)

      if (!nextTasks.length) {
        setError('No care tasks found for this order.')
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load care tasks for this order')
      setTasks([])
      setActivityLogs([])
    } finally {
      setLoading(false)
    }
  }, [orderId, taskFromQuery])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    ;(async () => {
      setOrderCtxLoading(true)
      setOrderCtxError(null)
      try {
        const name = task?.orderName
        const ctx = await getCareOrderContext(orderId, name)
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
  }, [orderId, task?.orderName])

  useEffect(() => {
    setOutcome('')
    setRemarks('')
    setCustomerResponse('')
    setCustomerRating(0)
    setNoteText('')
    setRescheduleAt('')
    setCallAfterAt('')
    setEscalateReason('')
  }, [activeTaskId])

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

  const onAction = async (target: CareTask, action: string) => {
    try {
      setSavingId(target.id)
      setError(null)
      setSuccess(null)
      if (action === 'confirm_cod') {
        await updateCareTask(target.id, { action: 'confirm_cod' })
        setSuccess(`Tagged ${target.orderName} as Care confirmed`)
      } else if (action === 'complete') {
        if (requiresCustomerRating(target) && (customerRating < 1 || customerRating > 5)) {
          throw new Error('Please rate the customer (1–5 stars) before completing')
        }
        await updateCareTask(target.id, {
          action: 'complete',
          outcome,
          remarks,
          customerResponse,
          ...(requiresCustomerRating(target) ? { customerRating } : {}),
        })
        setSuccess('Task completed')
      } else if (action === 'unreachable') {
        await updateCareTask(target.id, {
          action: 'unreachable',
          remarks: remarks || 'Customer unreachable',
        })
        setUnreachableConfirmTask(null)
        setSuccess('Marked unreachable')
      } else if (action === 'escalate') {
        const reason = escalateReason.trim()
        if (!reason) throw new Error('Escalate reason is required')
        const escTarget = escalationTargets.find((t) => t.email === escalateTargetEmail)
        if (!escTarget) throw new Error('Select who to escalate this task to')
        await updateCareTask(target.id, {
          action: 'escalate',
          remarks: reason,
          escalatedTo: escTarget,
        })
        setEscalateConfirmTask(null)
        setSuccess(`Escalated to ${escTarget.name || escTarget.email}`)
      } else if (action === 'call_after') {
        if (!callAfterAt) throw new Error('Pick a call-after date & time first')
        const when = new Date(callAfterAt).getTime()
        if (Number.isNaN(when)) throw new Error('Invalid call-after date')
        if (when > Date.now() + CALL_AFTER_MAX_MS) {
          throw new Error('Call After can be at most 3 days from now')
        }
        if (when < Date.now() - 60_000) throw new Error('Call-after time must be in the future')
        await updateCareTask(target.id, {
          action: 'call_after',
          scheduledAt: new Date(when).toISOString(),
          remarks,
        })
        setCallAfterConfirmTask(null)
        setSuccess('Scheduled call after')
      } else if (action === 'not_interested') {
        const reason = notInterestedReason.trim()
        if (!reason) throw new Error('Please enter a reason')
        await updateCareTask(target.id, {
          action: 'not_interested',
          remarks: reason,
          customerResponse: customerResponse || 'Customer not interested',
        })
        setNotInterestedConfirmTask(null)
        setSuccess('Marked not interested')
      } else if (action === 'reschedule') {
        if (!rescheduleAt) throw new Error('Pick a reschedule date & time first')
        const when = new Date(rescheduleAt).getTime()
        if (Number.isNaN(when)) throw new Error('Invalid reschedule date')
        await updateCareTask(target.id, {
          action: 'reschedule',
          scheduledAt: new Date(when).toISOString(),
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

  const onAddNote = async (target: CareTask) => {
    if (!noteText.trim()) return
    try {
      setSavingId(target.id)
      await addCareTaskNote(target.id, noteText.trim())
      setNoteText('')
      setSuccess('Note added')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to add note')
    } finally {
      setSavingId(null)
    }
  }

  const isOpenCall = (t: CareTask) =>
    t.status !== 'completed' && t.status !== 'not_interested'

  /** ✓ — COD confirm, or complete other calls (rating modal when required). */
  const onJourneyTick = async (step: CareTask) => {
    setActiveTaskId(step.id)
    setError(null)
    setSuccess(null)
    const kind = getCareTaskKind(step)
    if (kind === 'cod_confirmation') {
      await onAction(step, 'confirm_cod')
      return
    }
    if (requiresCustomerRating(step)) {
      setApproveRating(0)
      setApproveTask(step)
      return
    }
    try {
      setSavingId(step.id)
      await updateCareTask(step.id, {
        action: 'complete',
        outcome: 'Call completed',
        remarks: 'Marked done from call journey',
        customerResponse: 'Positive',
      })
      setSuccess(`${step.taskLabel} marked done`)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to complete call')
    } finally {
      setSavingId(null)
    }
  }

  const confirmJourneyApprove = async () => {
    if (!approveTask) return
    if (requiresCustomerRating(approveTask) && (approveRating < 1 || approveRating > 5)) {
      setError('Please rate the customer (1–5 stars)')
      return
    }
    try {
      setSavingId(approveTask.id)
      setError(null)
      await updateCareTask(approveTask.id, {
        action: 'complete',
        outcome: 'Call completed',
        remarks: 'Marked done from call journey',
        customerResponse: 'Positive',
        ...(requiresCustomerRating(approveTask) ? { customerRating: approveRating } : {}),
      })
      setApproveTask(null)
      setApproveRating(0)
      setSuccess(`${approveTask.taskLabel} marked done`)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to complete call')
    } finally {
      setSavingId(null)
    }
  }

  /** ✗ — ask reason, then not_interested (all call types). */
  const onJourneyCross = (step: CareTask) => {
    setActiveTaskId(step.id)
    setCrossReason('')
    setCrossReasonTask(step)
  }

  const confirmJourneyCross = async () => {
    if (!crossReasonTask) return
    const reason = crossReason.trim()
    if (!reason) {
      setError('Please enter a reason')
      return
    }
    try {
      setSavingId(crossReasonTask.id)
      setError(null)
      const kind = getCareTaskKind(crossReasonTask)
      if (kind === 'cod_confirmation') {
        await updateCareTask(crossReasonTask.id, {
          action: 'cancel_cod',
          remarks: reason,
        })
        setSuccess(`COD cancelled tag set — ${reason}`)
      } else {
        await updateCareTask(crossReasonTask.id, {
          action: 'not_interested',
          remarks: reason,
          customerResponse: 'Customer not interested',
        })
        setSuccess(`${crossReasonTask.taskLabel} marked not interested`)
      }
      setCrossReasonTask(null)
      setCrossReason('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to update call')
    } finally {
      setSavingId(null)
    }
  }

  const onJourneyAddNote = async (step: CareTask) => {
    const text = journeyNoteText.trim()
    if (!text) return
    try {
      setSavingId(step.id)
      setError(null)
      await addCareTaskNote(step.id, text)
      setJourneyNoteText('')
      setNoteOpenTaskId(null)
      setSuccess('Note added')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to add note')
    } finally {
      setSavingId(null)
    }
  }

  const busy = task ? savingId === task.id : false
  const isCodConfirm = journey.some(
    (t) => getCareTaskKind(t) === 'cod_confirmation' && t.status !== 'completed',
  )
  const codTask = journey.find(
    (t) => getCareTaskKind(t) === 'cod_confirmation' && t.status !== 'completed',
  )
  const showCreateOrder = journey.some((t) => {
    const k = getCareTaskKind(t)
    return k === 'upsell' || k === 'day_5' || k === 'day_23' || k === 'day_60' || k === 'day_90'
  })

  const openCreateShopifyOrder = () => {
    if (!task) return
    const c = orderCtx?.customer
    setCreateOrderPrefill({
      firstName: c?.firstName || task.customerName?.split(/\s+/)[0] || null,
      lastName:
        c?.lastName ||
        task.customerName?.split(/\s+/).slice(1).join(' ') ||
        null,
      email: c?.email || null,
      phone: c?.phone || task.phone || null,
      address1: c?.address1 || null,
      address2: c?.address2 || null,
      city: c?.city || orderCtx?.city || null,
      province: c?.province || orderCtx?.state || null,
      zip: c?.zip || orderCtx?.pincode || null,
      country: c?.country || 'India',
      sourceOrderName: task.orderName || null,
      note: `Upsell from ${task.taskLabel || 'care task'} · ${task.orderName || task.orderId}`,
    })
    setCreateOrderOpen(true)
  }

  const shipState = orderCtx?.state || orderCtx?.operational?.state || orderCtx?.order?.state || null
  const shipCity = orderCtx?.city || orderCtx?.operational?.city || orderCtx?.order?.city || null
  const shipEtd = orderCtx?.etd || orderCtx?.operational?.etd || orderCtx?.order?.etd || null

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-5xl mx-auto mt-20">
          {!isExec && <SubNav />}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <a
              href={backLink.href}
              className="inline-flex items-center gap-1.5 text-sm font-semibold"
              style={{ color: 'var(--foreground-muted)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              {backLink.label}
            </a>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2" style={{ color: 'var(--foreground-muted)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading care workspace…
            </div>
          ) : !task ? (
            <div
              className="rounded-xl border p-8 text-center text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--card)' }}
            >
              {error || 'No care tasks found for this order.'}
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      {task.paymentMethod === 'cod' && <span className={badge('purple')}>COD</span>}
                      <span className={badge(statusBadge(task).tone)}>{statusBadge(task).label}</span>
                      {task.priority === 'high' && !isCareTaskCodConfirmed(task) && (
                        <span className={badge('red')}>High</span>
                      )}
                      {orderCtx?.repeatedCustomer && (
                        <span className={badge('amber')}>
                          Repeated customer · {orderCtx.samePhoneOrderCount} orders
                        </span>
                      )}
                    </div>
                    <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                      <OrderIdLink
                        orderId={task.orderId}
                        orderName={task.orderName}
                        href={careOrderWorkspaceHref(task.orderId, task.id, fromQuery || null)}
                        title="Care task workspace"
                      />
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                      {task.packLabel || '—'}
                      {task.orderCreatedAt ? ` · ordered ${fmtDay(task.orderCreatedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isCodConfirm && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAction(codTask || task, 'confirm_cod')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Confirm order
                      </button>
                    )}
                    {showCreateOrder && (
                      <button
                        type="button"
                        onClick={openCreateShopifyOrder}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white"
                      >
                        <PackagePlus className="w-4 h-4" />
                        Create Shopify order
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
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
                    {orderCtx?.repeatedCustomer && (
                      <p className="text-[11px] mt-1 font-semibold text-amber-700 dark:text-amber-300">
                        Same number has {orderCtx.samePhoneOrderCount} orders on record
                      </p>
                    )}
                    {(shipState || shipCity) && (
                      <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                        <MapPin className="w-3 h-3" />
                        {[shipCity, shipState].filter(Boolean).join(', ')}
                      </p>
                    )}
                    <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                      <Truck className="w-3 h-3" />
                      ETD {orderCtxLoading ? '…' : shipEtd ? fmtDay(shipEtd) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                      {task.status === 'rescheduled' ? 'Call after' : 'Due'}
                    </p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                      {fmtDay(task.scheduledAt)}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                      {fmtWhen(task.scheduledAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                      {task.status === 'escalated' ? 'Escalation reason' : 'Last note'}
                    </p>
                    <p className="text-[12px]" style={{ color: 'var(--foreground-muted)' }}>
                      {task.status === 'escalated'
                        ? escalationReason(task) || 'No reason recorded'
                        : task.notes?.[0]?.text || task.remarks || 'No notes yet'}
                    </p>
                  </div>
                </div>
              </div>

              {(orderCtxLoading || (orderCtx?.samePhoneOrders && orderCtx.samePhoneOrders.length > 0)) && (
                <div
                  className="rounded-xl border p-4"
                  style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <p
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--foreground-muted)' }}
                      >
                        Orders on this number
                      </p>
                      <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--foreground)' }}>
                        {orderCtxLoading
                          ? 'Loading…'
                          : orderCtx?.repeatedCustomer
                            ? `${orderCtx.samePhoneOrderCount} orders · repeated customer`
                            : '1 order on this number'}
                      </p>
                    </div>
                    {orderCtx?.repeatedCustomer && <span className={badge('amber')}>Repeated customer</span>}
                  </div>

                  {orderCtxLoading ? (
                    <p className="text-sm flex items-center gap-2" style={{ color: 'var(--foreground-muted)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Matching phone across orders…
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto pb-2 -mx-1 px-1 mb-3">
                        <ol className="flex items-stretch gap-0 min-w-min">
                          {(orderCtx?.samePhoneOrders || []).map((o, idx, arr) => (
                            <li key={String(o.id)} className="flex items-center shrink-0">
                              <div
                                className="w-44 rounded-lg border p-2.5"
                                style={{
                                  borderColor: o.isCurrent
                                    ? 'rgba(147, 51, 234, 0.45)'
                                    : 'var(--border)',
                                  background: o.isCurrent
                                    ? 'rgba(147, 51, 234, 0.06)'
                                    : 'var(--background)',
                                }}
                              >
                                <p
                                  className={`text-[10px] font-bold uppercase ${
                                    o.isCurrent ? 'text-purple-600' : ''
                                  }`}
                                  style={
                                    o.isCurrent ? undefined : { color: 'var(--foreground-muted)' }
                                  }
                                >
                                  {o.isCurrent ? 'Current' : `Order ${idx + 1}`}
                                  {o.cancelled_at ? ' · cancelled' : ''}
                                </p>
                                <p
                                  className="text-sm font-extrabold truncate"
                                  style={{ color: 'var(--foreground)' }}
                                >
                                  <a
                                    href={careOrderWorkspaceHref(o.id, null, fromQuery || null)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-600 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {o.name}
                                  </a>
                                </p>
                                <p
                                  className="text-[11px] mt-0.5"
                                  style={{ color: 'var(--foreground-muted)' }}
                                >
                                  Placed {fmtWhen(o.created_at)}
                                </p>
                                <p
                                  className="text-[11px] line-clamp-1"
                                  style={{ color: 'var(--foreground-muted)' }}
                                >
                                  {o.productTitle || o.statusLabel || '—'}
                                  {o.total_price
                                    ? ` · ${o.currency || 'INR'} ${o.total_price}`
                                    : ''}
                                </p>
                              </div>
                              {idx < arr.length - 1 && (
                                <div
                                  className="w-6 h-0.5 mx-1 rounded-full shrink-0"
                                  style={{ background: 'rgba(147, 51, 234, 0.35)' }}
                                />
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr
                              className="text-[10px] font-bold uppercase tracking-wider border-b"
                              style={{ color: 'var(--foreground-muted)', borderColor: 'var(--border)' }}
                            >
                              <th className="py-2 pr-3">Order</th>
                              <th className="py-2 pr-3">Placed</th>
                              <th className="py-2 pr-3">Status</th>
                              <th className="py-2 pr-3">Item</th>
                              <th className="py-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(orderCtx?.samePhoneOrders || []).map((o) => (
                              <tr
                                key={`row-${o.id}`}
                                className="border-b last:border-0"
                                style={{ borderColor: 'var(--border)' }}
                              >
                                <td className="py-2 pr-3 font-semibold">
                                  <a
                                    href={careOrderWorkspaceHref(o.id, null, fromQuery || null)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-600 hover:underline"
                                  >
                                    {o.name}
                                  </a>
                                  {o.isCurrent && (
                                    <span className="ml-1.5 text-[10px] font-bold text-purple-600">
                                      current
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 pr-3" style={{ color: 'var(--foreground-muted)' }}>
                                  {fmtWhen(o.created_at)}
                                </td>
                                <td className="py-2 pr-3" style={{ color: 'var(--foreground-muted)' }}>
                                  {o.cancelled_at ? 'Cancelled' : o.statusLabel || '—'}
                                </td>
                                <td
                                  className="py-2 pr-3 max-w-[10rem] truncate"
                                  style={{ color: 'var(--foreground-muted)' }}
                                >
                                  {o.productTitle || '—'}
                                </td>
                                <td className="py-2 tabular-nums" style={{ color: 'var(--foreground)' }}>
                                  {o.currency || 'INR'} {o.total_price}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div
                className="rounded-xl border p-4 space-y-5"
                style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
              >
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                    Call journey
                  </p>
                  <ol className="space-y-2">
                    {journey.map((step, idx) => {
                      const stepSt = statusBadge(step)
                      const selected = task.id === step.id
                      const open = isOpenCall(step)
                      const stepBusy = savingId === step.id
                      const noteOpen = noteOpenTaskId === step.id
                      return (
                        <li key={step.id}>
                          <div
                            className="rounded-xl border p-3"
                            style={{
                              borderColor: selected ? 'rgba(147, 51, 234, 0.45)' : 'var(--border)',
                              background: selected ? 'rgba(147, 51, 234, 0.06)' : 'var(--card)',
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => setActiveTaskId(step.id)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                  <span className="text-[10px] font-bold" style={{ color: 'var(--foreground-muted)' }}>
                                    {idx + 1}/{journey.length}
                                  </span>
                                  <span className={badge(stepSt.tone)}>{stepSt.label}</span>
                                </div>
                                <p className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                                  {step.taskLabel}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                                  Due {fmtWhen(step.scheduledAt)}
                                  {step.notes?.[0]?.text
                                    ? ` · ${step.notes[0].text}`
                                    : step.remarks
                                      ? ` · ${step.remarks}`
                                      : ''}
                                </p>
                              </button>

                              {open ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={stepBusy}
                                    title="Mark done / confirm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void onJourneyTick(step)
                                    }}
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white disabled:opacity-50 hover:bg-emerald-700"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={stepBusy}
                                    title="Decline — reason required"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onJourneyCross(step)
                                    }}
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-600 text-white disabled:opacity-50 hover:bg-red-700"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={stepBusy}
                                    title="Add note"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActiveTaskId(step.id)
                                      setNoteOpenTaskId(noteOpen ? null : step.id)
                                      setJourneyNoteText('')
                                    }}
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border disabled:opacity-50"
                                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                                  >
                                    <StickyNote className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                selected && (
                                  <span className="text-[10px] font-bold text-purple-600 shrink-0">Working</span>
                                )
                              )}
                            </div>

                            {noteOpen && open && (
                              <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                                <input
                                  value={journeyNoteText}
                                  onChange={(e) => setJourneyNoteText(e.target.value)}
                                  placeholder="Add a note for this call…"
                                  className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30"
                                  style={{
                                    background: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void onJourneyAddNote(step)
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={stepBusy || !journeyNoteText.trim()}
                                  onClick={() => void onJourneyAddNote(step)}
                                  className="px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-40"
                                >
                                  Save
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </div>

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
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      Pack
                    </span>{' '}
                    {task.packLabel || '—'}
                  </span>
                  <span>
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      Call due
                    </span>{' '}
                    {task.scheduleDay < 0
                      ? 'Right after order placed'
                      : `Day ${task.scheduleDay} after delivery`}
                  </span>
                  {isAdmin && (
                    <span>
                      <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        Assignee
                      </span>{' '}
                      {task.assignedTo?.email || '—'}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Last call:{' '}
                    {latestDeviceCallAt
                      ? fmtWhen(latestDeviceCallAt)
                      : deviceRecordings.length
                        ? `${deviceRecordings.length} recording${deviceRecordings.length === 1 ? '' : 's'}`
                        : 'None'}
                  </span>
                  <span>
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      Est. delivery
                    </span>{' '}
                    {shipEtd ? fmtWhen(shipEtd) : orderCtxLoading ? '…' : 'Not available yet'}
                  </span>
                  {orderCtx?.operational && (
                    <span>
                      <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        Fulfillment
                      </span>{' '}
                      {orderCtx.statusLabel}
                      {orderCtx.operational.awb ? ` · ${orderCtx.operational.awb}` : ''}
                      {orderCtx.operational.courier ? ` · ${orderCtx.operational.courier}` : ''}
                    </span>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                    Order trail
                  </p>
                  {orderCtxLoading && (
                    <p className="text-sm flex items-center gap-2" style={{ color: 'var(--foreground-muted)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading shipment trail…
                    </p>
                  )}
                  {orderCtxError && <p className="text-sm text-red-500">{orderCtxError}</p>}
                  {!orderCtxLoading && orderCtx && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
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
                          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
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
                                  ...(orderCtx.clones || []).map((clone: any, idx: number) => ({
                                    key: String(clone.id),
                                    title: `Clone${orderCtx.clones.length > 1 ? ` ${idx + 1}` : ''}${
                                      idx === orderCtx.clones.length - 1 ? ' · active' : ''
                                    }`,
                                    name: clone.name,
                                    sub: `${fmtDay(clone.created_at)} · ${clone.statusLabel}`,
                                    awb: clone.awb,
                                    active: idx === orderCtx.clones.length - 1,
                                  })),
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
                                          node.active ? undefined : { color: 'var(--foreground-muted)' }
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

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                    Activity
                  </p>
                  {activityItems.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                      No activity yet for this order.
                    </p>
                  ) : (
                    <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {activityItems.map((item) => (
                        <li
                          key={item.id}
                          className="text-sm leading-snug"
                          style={{ color: 'var(--foreground)' }}
                        >
                          <span className="font-semibold">{item.title}</span>
                          {item.by ? (
                            <span style={{ color: 'var(--foreground-muted)' }}> · {item.by}</span>
                          ) : null}
                          <span style={{ color: 'var(--foreground-muted)' }}> · {fmtWhen(item.at)}</span>
                          {item.detail ? (
                            <p
                              className="text-[12px] mt-0.5 line-clamp-3"
                              style={{ color: 'var(--foreground-muted)' }}
                            >
                              {item.detail}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <Headphones className="w-3 h-3" />
                    Call recordings
                  </p>
                  {recordingsLoading && deviceRecordings.length === 0 ? (
                    <p className="text-sm flex items-center gap-2" style={{ color: 'var(--foreground-muted)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading recordings…
                    </p>
                  ) : deviceRecordings.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                      No call recordings for this number yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {deviceRecordings.map((rec) => (
                        <div
                          key={rec.id}
                          className="py-2 border-t first:border-0"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <p className="text-[12px]" style={{ color: 'var(--foreground-muted)' }}>
                              {rec.createdAt ? fmtWhen(rec.createdAt) : `Call ${rec.callLogId}`}
                              {' · '}
                              {rec.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                              {' · '}
                              {rec.durationSec || 0}s
                            </p>
                            {rec.orderName ? (
                              <span className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                {rec.orderName}
                              </span>
                            ) : null}
                          </div>
                          <CallAudioPlayer
                            callId={rec.id}
                            streamUrl={getDeviceRecordingStreamUrl(rec.id)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {task.status !== 'completed' && task.status !== 'not_interested' ? (
                  <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                      After the call · {task.taskLabel}
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
                        <p className="font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                          Not interested
                        </p>
                        <p style={{ color: 'var(--foreground-muted)' }}>Reason: {task.remarks || '—'}</p>
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
                      </>
                    )}
                  </div>
                )}
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

      {crossReasonTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Why is this call declined?
              </h3>
              <button type="button" onClick={() => setCrossReasonTask(null)} className="p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              {crossReasonTask.orderName} — {crossReasonTask.taskLabel}
            </p>
            <textarea
              value={crossReason}
              onChange={(e) => setCrossReason(e.target.value)}
              rows={3}
              placeholder="Reason required…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCrossReasonTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === crossReasonTask.id || !crossReason.trim()}
                onClick={() => void confirmJourneyCross()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {approveTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                Mark call done
              </h3>
              <button type="button" onClick={() => setApproveTask(null)} className="p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              {approveTask.orderName} — {approveTask.taskLabel}
            </p>
            {requiresCustomerRating(approveTask) && (
              <div>
                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                  Customer rating * (1–5)
                </span>
                <div className="mt-1.5 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setApproveRating(n)}
                      className="p-0.5"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          n <= approveRating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-[var(--foreground-muted)]'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproveTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  savingId === approveTask.id ||
                  (requiresCustomerRating(approveTask) && approveRating < 1)
                }
                onClick={() => void confirmJourneyApprove()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
              >
                Mark done
              </button>
            </div>
          </div>
        </div>
      )}

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
              <button type="button" onClick={() => setUnreachableConfirmTask(null)} className="p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--foreground-muted)' }}>
              Move {unreachableConfirmTask.orderName} to Unreachable?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnreachableConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
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

      {escalateConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
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
                style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
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
                style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEscalateConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
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

      {notInterestedConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
              Not interested
            </h3>
            <textarea
              value={notInterestedReason}
              onChange={(e) => setNotInterestedReason(e.target.value)}
              rows={3}
              placeholder="Reason required"
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotInterestedConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === notInterestedConfirmTask.id || !notInterestedReason.trim()}
                onClick={() => onAction(notInterestedConfirmTask, 'not_interested')}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {callAfterConfirmTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl space-y-3"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
              Call after
            </h3>
            <input
              type="datetime-local"
              value={callAfterAt}
              onChange={(e) => setCallAfterAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCallAfterConfirmTask(null)}
                className="px-3 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--border)' }}
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

      <CreateShopifyOrderDialog
        open={createOrderOpen}
        onClose={() => {
          setCreateOrderOpen(false)
          setCreateOrderPrefill(null)
        }}
        prefill={createOrderPrefill}
        agent={{ name: user?.name, email: user?.email }}
        onCreated={(result) => {
          setCreateOrderOpen(false)
          setCreateOrderPrefill(null)
          setSuccess(`Created ${result.orderName || 'order'} on Shopify`)
        }}
      />
    </div>
  )
}
