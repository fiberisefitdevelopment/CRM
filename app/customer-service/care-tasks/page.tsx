'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  User,
  MoreHorizontal,
  X,
  ExternalLink,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { OrderIdLink } from '@/components/customer-service/OrderIdLink'
import { ErrorToast } from '@/components/ErrorToast'
import {
  badge,
  careOrderWorkspaceHref,
  escalationReason,
  fmtDay,
  fmtWhen,
  isTaskOverdue,
  openCareOrderWorkspace,
  statusBadge,
} from '@/components/customer-service/careTaskShared'
import {
  generateCareTasks,
  getCarePerformance,
  getCareTaskSummary,
  listCareTasks,
  updateCareTask,
  type CareTask,
  type CareTaskSummary,
  type CareOrderGroup,
  type ExecutivePerformance,
} from '@/lib/careTasksApi'
import { isAdminRole, isCareExecutiveRole } from '@/src/utils/accessControl'
import { useAuth } from '@/lib/auth'
import {
  CARE_TASK_KIND_TABS,
  getCareTaskKind,
  type CareTaskKind,
} from '@/src/services/careTasks/types'
import { isCareTaskCodConfirmed } from '@/src/utils/careOrderTags'

type StatusFilter =
  | 'inbox'
  | 'today'
  | 'overdue'
  | 'upcoming'
  | 'rescheduled'
  | 'unreachable'
  | 'escalated'
  | 'not_interested'
  | 'completed'
  | 'all'
type PageSize = 20 | 50 | 100

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100]
const REMINDER_SEEN_KEY = 'fiberise_care_unreachable_reminders'

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

export default function CareTasksPage() {
  const { user } = useAuth()
  const role = user?.role || null
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [orderGroups, setOrderGroups] = useState<CareOrderGroup[]>([])
  const [summary, setSummary] = useState<CareTaskSummary | null>(null)
  const [performance, setPerformance] = useState<ExecutivePerformance[]>([])
  const [kindFilter, setKindFilter] = useState<CareTaskKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showMoreTools, setShowMoreTools] = useState(false)
  const autoGenerateTried = useRef(false)
  const loadSeq = useRef(0)
  const execDefaultsApplied = useRef(false)

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

  const panelKind = isExec || kindFilter === 'all' ? 'all' : kindFilter

  const loadPanelEscalated = useCallback(async () => {
    if (role === null) return
    try {
      const allRes = await listCareTasks({ status: 'escalated', kind: 'all', pageSize: 100 })
      const counts: Record<string, number> = {}
      for (const t of allRes.tasks) {
        const k = getCareTaskKind(t)
        counts[k] = (counts[k] || 0) + 1
      }
      setEscalatedKindCounts(counts)
      const panelTasks =
        panelKind === 'all'
          ? allRes.tasks
          : allRes.tasks.filter((t) => getCareTaskKind(t) === panelKind)
      setPanelEscalatedTasks(panelTasks)
    } catch {
      setPanelEscalatedTasks([])
      setEscalatedKindCounts({})
    }
  }, [role, panelKind])

  // Server-paginated list — only the current page is returned.
  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    // Keep previous rows visible while refreshing (no empty flash)
    try {
      const listRes = await listCareTasks({
        status: statusFilter,
        kind: isExec || kindFilter === 'all' ? 'all' : kindFilter,
        search: debouncedSearch || undefined,
        page,
        pageSize,
        assignee: isAdmin && executiveFilter ? executiveFilter : undefined,
        groupBy: 'order',
      })
      if (seq !== loadSeq.current) return null

      setTasks(listRes.tasks)
      setOrderGroups(listRes.groups || [])
      setTotal(listRes.total)
      setTotalPages(listRes.totalPages)
      setKindCounts(listRes.kindCounts || {})
      if (listRes.page !== page) setPage(listRes.page)
      setLoading(false)

      // Summary after list paints (shared server cache makes this cheap)
      void getCareTaskSummary(isAdmin && executiveFilter ? executiveFilter : undefined)
        .then((sum) => {
          if (seq === loadSeq.current) setSummary(sum)
        })
        .catch(() => {})

      return listRes.total
    } catch (err: any) {
      if (seq === loadSeq.current) {
        if (!silent) setError(err?.message || 'Failed to load care tasks')
        setLoading(false)
      }
      return null
    }
  }, [statusFilter, kindFilter, debouncedSearch, page, pageSize, isAdmin, isExec, executiveFilter])

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
    const interval = window.setInterval(() => {
      void load(true)
    }, 5000)
    return () => window.clearInterval(interval)
  }, [role, load])

  useEffect(() => {
    if (!isAdmin) return
    void getCarePerformance()
      .then(setPerformance)
      .catch(() => setPerformance([]))
  }, [isAdmin])

  useEffect(() => {
    if (role === null) return
    void loadPanelEscalated()
  }, [role, panelKind, loadPanelEscalated])

  const openEscalatedTask = (task: CareTask) => {
    setEscalatedPanelOpen(false)
    openCareOrderWorkspace(task.orderId, task.id)
  }

  const safePage = Math.min(page, totalPages)
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize
  const pageEnd = Math.min(pageStart + orderGroups.length, total)

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages))
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

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

  const onConfirmCod = async (task: CareTask) => {
    try {
      setSavingId(task.id)
      setError(null)
      setSuccess(null)
      await updateCareTask(task.id, { action: 'confirm_cod' })
      setSuccess(`Tagged ${task.orderName} as Care confirmed (Orders / Order Status)`)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Action failed')
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

  const statusFilterCounts: Partial<Record<StatusFilter, number>> = summary
    ? {
        inbox: summary.pending,
        overdue: summary.overdue,
        rescheduled: summary.rescheduled,
        unreachable: summary.unreachable,
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
    if (open && reminderTask) openCareOrderWorkspace(reminderTask.orderId, reminderTask.id)
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
                              <OrderIdLink
                                orderId={task.orderId}
                                orderName={task.orderName}
                                href={careOrderWorkspaceHref(task.orderId, task.id)}
                                title="Open care workspace in a new tab"
                              />
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
                    ? 'No Call After tasks right now.'
                    : statusFilter === 'unreachable'
                      ? 'No unreachable tasks right now.'
                      : statusFilter === 'escalated'
                      ? 'No escalated tasks right now.'
                      : statusFilter === 'not_interested'
                        ? 'No not-interested tasks yet.'
                        : 'Nothing for this status yet. Try Generate tasks from COD orders.'}
              </p>
              {!debouncedSearch &&
                statusFilter !== 'rescheduled' &&
                statusFilter !== 'unreachable' &&
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
                  </span>{' '}
                  orders
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

              {orderGroups.map((group) => {
                const task =
                  group.tasks.find((t) => t.id === group.focusTaskId) || group.tasks[0]
                if (!task) return null
                const st = statusBadge(task)
                const overdue = group.tasks.some((t) => isTaskOverdue(t))
                const busy = savingId === task.id
                const isCodConfirm = group.tasks.some(
                  (t) =>
                    getCareTaskKind(t) === 'cod_confirmation' && t.status !== 'completed',
                )
                const codTask = group.tasks.find(
                  (t) =>
                    getCareTaskKind(t) === 'cod_confirmation' && t.status !== 'completed',
                )
                const workspaceHref = careOrderWorkspaceHref(
                  group.orderId,
                  group.focusTaskId || task.id,
                )

                return (
                  <div
                    key={group.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => openCareOrderWorkspace(group.orderId, group.focusTaskId || task.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openCareOrderWorkspace(group.orderId, group.focusTaskId || task.id)
                      }
                    }}
                    className={`crm-card overflow-hidden border cursor-pointer hover:border-purple-500/40 transition-colors ${
                      overdue ? 'ring-1 ring-red-500/35' : ''
                    }`}
                    style={{
                      borderColor: overdue ? 'rgba(239, 68, 68, 0.45)' : 'var(--border)',
                    }}
                    title="Open care workspace in a new tab"
                  >
                    <div className="w-full text-left p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-0.5 p-0.5 rounded"
                          style={{ color: 'var(--foreground-muted)' }}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </div>

                        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-3">
                          <div className="md:col-span-4">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              {group.paymentMethod === 'cod' && (
                                <span className={badge('purple')}>COD</span>
                              )}
                              {group.tasks.length > 1 && (
                                <span className={badge('blue')}>{group.tasks.length} calls</span>
                              )}
                              <span className={badge(st.tone)}>{st.label}</span>
                              {group.tasks.some((t) => t.priority === 'high' && !isCareTaskCodConfirmed(t)) && (
                                <span className={badge('red')}>High</span>
                              )}
                            </div>
                            <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                              <OrderIdLink
                                orderId={group.orderId}
                                orderName={group.orderName}
                                href={workspaceHref}
                                title="Open care workspace in a new tab"
                              />
                            </p>
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                              {group.packLabel || task.packLabel || '—'}
                              {group.orderCreatedAt ? ` · ordered ${fmtDay(group.orderCreatedAt)}` : ''}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {group.tasks.map((step) => {
                                const stepSt = statusBadge(step)
                                return (
                                  <span
                                    key={step.id}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded border"
                                    style={{
                                      borderColor: 'var(--border)',
                                      color: 'var(--foreground)',
                                      background: 'var(--card)',
                                    }}
                                  >
                                    {step.taskLabel.replace(/ Call$/i, '')}
                                    <span className="opacity-60"> · {stepSt.label}</span>
                                  </span>
                                )
                              })}
                            </div>
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
                              {group.tasks.length > 1 ? ` · ${task.taskLabel.replace(/ Call$/i, '')}` : ''}
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
                          </div>
                        </div>
                      </div>
                    </div>

                    {isCodConfirm && (
                      <div
                        className="flex flex-wrap items-center gap-2 px-4 pb-3 -mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onConfirmCod(codTask || task)}
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
