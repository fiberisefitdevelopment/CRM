import { apiFetch } from '@/lib/auth'
import type {
  CareTask,
  CareTaskSummary,
  ExecutivePerformance,
} from '@/src/services/careTasks/types'

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export async function listCareTasks(params?: {
  status?: string
  kind?: string
  search?: string
  page?: number
  pageSize?: 20 | 50 | 100 | number
  assignee?: string
}): Promise<{
  tasks: CareTask[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  kindCounts: Record<string, number>
}> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.kind) qs.set('kind', params.kind)
  if (params?.search) qs.set('search', params.search)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize))
  if (params?.assignee) qs.set('assignee', params.assignee)
  const res = await apiFetch(`/api/care-tasks?${qs.toString()}`, { cache: 'no-store' })
  const data = await parseJson(res)
  return {
    tasks: data.tasks || [],
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    pageSize: Number(data.pageSize || 20),
    totalPages: Number(data.totalPages || 1),
    kindCounts: data.kindCounts || {},
  }
}

export async function getCareTaskSummary(assignee?: string): Promise<CareTaskSummary> {
  const qs = assignee ? `?assignee=${encodeURIComponent(assignee)}` : ''
  const res = await apiFetch(`/api/care-tasks/summary${qs}`, { cache: 'no-store' })
  const data = await parseJson(res)
  return data.summary
}

export async function getCarePerformance(): Promise<ExecutivePerformance[]> {
  const res = await apiFetch('/api/care-tasks/performance', { cache: 'no-store' })
  const data = await parseJson(res)
  return data.executives || []
}

export async function getEscalationTargets(): Promise<
  Array<{ userId: string; email: string; name: string }>
> {
  const res = await apiFetch('/api/care-tasks/escalation-targets', { cache: 'no-store' })
  const data = await parseJson(res)
  return data.users || []
}

export async function getCareTask(id: string): Promise<CareTask> {
  const res = await apiFetch(`/api/care-tasks/${encodeURIComponent(id)}`, { cache: 'no-store' })
  const data = await parseJson(res)
  return data.task
}

export async function updateCareTask(
  id: string,
  body: Record<string, unknown>,
): Promise<CareTask> {
  const res = await apiFetch(`/api/care-tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  return data.task
}

export async function addCareTaskNote(id: string, text: string): Promise<CareTask> {
  const res = await apiFetch(`/api/care-tasks/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await parseJson(res)
  return data.task
}

export async function syncCareTaskCalls(hoursBack = 48) {
  const res = await apiFetch('/api/care-tasks/sync-calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hoursBack }),
  })
  return parseJson(res)
}

export async function generateCareTasks(maxOrders = 200, refresh = true) {
  const res = await apiFetch('/api/care-tasks/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxOrders, refresh }),
  })
  return parseJson(res)
}

export async function getCareOrderContext(orderId: string, orderName?: string) {
  const qs = new URLSearchParams()
  if (orderId) qs.set('orderId', orderId)
  if (orderName) qs.set('orderName', orderName)
  const res = await apiFetch(`/api/care-tasks/order-context?${qs.toString()}`, {
    cache: 'no-store',
  })
  return parseJson(res)
}

export type DeliveredOrderForCare = {
  id: number | string
  name: string
  created_at: string
  total_price: string
  currency?: string
  financial_status?: string
  payment_method?: string | null
  customer?: {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
  } | null
  shipping_address?: {
    city?: string
    province?: string
    phone?: string
  } | null
  care_tag?: any
  care_executive?: any
  delivered_at?: string | null
  hasOpenUpsell: boolean
  upsellTaskId: string
  upsellStatus?: string | null
  upsellAssignee?: { email?: string; name?: string } | null
}

export type DeliveredOrdersCareSummary = {
  delivered: number
  openUpsell: number
  needsUpsell: number
}

export async function listDeliveredOrdersForCare(params?: {
  page?: number
  pageSize?: number
  search?: string
}): Promise<{
  orders: DeliveredOrderForCare[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: DeliveredOrdersCareSummary
}> {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize))
  if (params?.search) qs.set('search', params.search)
  const res = await apiFetch(`/api/care-tasks/delivered-orders?${qs.toString()}`, {
    cache: 'no-store',
  })
  const data = await parseJson(res)
  const total = Number(data.pagination?.total || 0)
  return {
    orders: data.orders || [],
    pagination: {
      page: Number(data.pagination?.page || 1),
      pageSize: Number(data.pagination?.pageSize || 20),
      total,
      totalPages: Number(data.pagination?.totalPages || 1),
    },
    summary: {
      delivered: Number(data.summary?.delivered ?? total),
      openUpsell: Number(data.summary?.openUpsell || 0),
      needsUpsell: Number(data.summary?.needsUpsell || 0),
    },
  }
}

export async function createUpsellCareTask(
  orderId: string | number,
  orderName?: string,
): Promise<{ created: boolean; task: CareTask | null }> {
  const res = await apiFetch('/api/care-tasks/upsell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, orderName }),
  })
  const data = await parseJson(res)
  return { created: Boolean(data.created), task: data.task || null }
}

export type { CareTask, CareTaskSummary, ExecutivePerformance }
