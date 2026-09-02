import { apiFetch } from '@/lib/auth'
import type {
  CareTask,
  CareTaskSummary,
  CareOrderGroup,
  ExecutivePerformance,
} from '@/src/services/careTasks/types'
import type { DeviceCallRecording } from '@/src/services/careTasks/deviceRecordings'

export type { DeviceCallRecording }

async function parseJson(res: Response) {
  const text = await res.text().catch(() => '')
  let data: any = {}
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      data = {}
    }
  }
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
  sort?: string
  deliveredOnly?: boolean
  day?: 'all' | '5' | '23' | '28' | '90' | 'manual'
  pack?: 'all' | '7' | '30' | '90'
  groupBy?: 'task' | 'order'
  refresh?: boolean
}): Promise<{
  tasks: CareTask[]
  groups: CareOrderGroup[]
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
  if (params?.sort) qs.set('sort', params.sort)
  if (params?.deliveredOnly) qs.set('deliveredOnly', '1')
  if (params?.day && params.day !== 'all') qs.set('day', params.day)
  if (params?.pack && params.pack !== 'all') qs.set('pack', params.pack)
  if (params?.groupBy === 'order') qs.set('groupBy', 'order')
  if (params?.refresh) qs.set('refresh', '1')
  const res = await apiFetch(`/api/care-tasks?${qs.toString()}`, { cache: 'no-store' })
  const data = await parseJson(res)
  return {
    tasks: data.tasks || [],
    groups: Array.isArray(data.groups) ? data.groups : [],
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

export function getDeviceRecordingStreamUrl(id: string): string {
  return `/api/care-tasks/device-recordings/${encodeURIComponent(id)}?mode=proxy`
}

export async function listDeviceCareRecordings(
  phone: string,
  orderId?: string,
): Promise<DeviceCallRecording[]> {
  const qs = new URLSearchParams()
  if (phone) qs.set('phone', phone)
  if (orderId) qs.set('orderId', orderId)
  const res = await apiFetch(`/api/care-tasks/device-recordings?${qs.toString()}`, {
    cache: 'no-store',
  })
  const data = await parseJson(res)
  return Array.isArray(data.recordings) ? data.recordings : []
}

export async function syncCareTaskCalls(hoursBack = 48) {
  const res = await apiFetch('/api/care-tasks/sync-calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hoursBack }),
  })
  return parseJson(res)
}

export async function generateCareTasks(
  maxOrders = 200,
  refresh = true,
  opts?: { forceEven?: boolean },
) {
  const res = await apiFetch('/api/care-tasks/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maxOrders,
      refresh,
      forceEven: opts?.forceEven === true,
    }),
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

export async function getCareOrderActivity(
  orderId: string,
  taskIds?: string[],
): Promise<
  Array<{
    id: string
    action: string
    orderId: string | null
    orderName: string | null
    taskId: string | null
    details: Record<string, unknown>
    status: string
    createdAt: string | null
  }>
> {
  const qs = new URLSearchParams()
  qs.set('orderId', orderId)
  if (taskIds?.length) qs.set('taskIds', taskIds.join(','))
  const res = await apiFetch(`/api/care-tasks/activity?${qs.toString()}`, {
    cache: 'no-store',
  })
  const data = await parseJson(res)
  return Array.isArray(data.logs) ? data.logs : []
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

export type DeliveredOrdersUpsellFilter = 'all' | 'needs' | 'open'
export type DeliveredOrdersPaymentFilter = 'all' | 'cod' | 'prepaid'
export type DeliveredOrdersDatePreset = '7days' | '30days' | '90days' | 'all'
export type DeliveredOrdersSort =
  | 'delivered_desc'
  | 'delivered_asc'
  | 'ordered_desc'
  | 'ordered_asc'
  | 'total_desc'
  | 'total_asc'
  | 'name_asc'

export async function listDeliveredOrdersForCare(params?: {
  page?: number
  pageSize?: number
  search?: string
  upsell?: DeliveredOrdersUpsellFilter
  payment?: DeliveredOrdersPaymentFilter
  datePreset?: DeliveredOrdersDatePreset
  sort?: DeliveredOrdersSort
}): Promise<{
  orders: DeliveredOrderForCare[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: DeliveredOrdersCareSummary
}> {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize))
  if (params?.search) qs.set('search', params.search)
  if (params?.upsell && params.upsell !== 'all') qs.set('upsell', params.upsell)
  if (params?.payment && params.payment !== 'all') qs.set('payment', params.payment)
  if (params?.datePreset) qs.set('datePreset', params.datePreset)
  if (params?.sort) qs.set('sort', params.sort)
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

export type ShopifyCatalogVariant = {
  id: number
  productId: number
  productTitle: string
  title: string
  sku: string
  price: string
  available: boolean
}

export async function listShopifyCareProducts(q?: string): Promise<{
  variants: ShopifyCatalogVariant[]
  total: number
}> {
  const qs = new URLSearchParams()
  if (q?.trim()) qs.set('q', q.trim())
  const res = await apiFetch(`/api/care-tasks/shopify-products?${qs.toString()}`, {
    cache: 'no-store',
  })
  const data = await parseJson(res)
  return {
    variants: data.variants || [],
    total: Number(data.total || 0),
  }
}

export async function createShopifyCareOrder(body: {
  email?: string
  phone: string
  note?: string
  payment: 'cod' | 'paid'
  shipping: {
    firstName: string
    lastName?: string
    phone: string
    address1: string
    address2?: string
    city: string
    province: string
    zip: string
    country?: string
  }
  lineItems: Array<{
    variantId?: number | null
    title?: string
    quantity: number
    price?: string
  }>
}): Promise<{
  orderId: number | string | null
  orderName: string | null
  payment: string
  invoiceUrl: string | null
  createdBy: { email: string; name: string } | null
  order: {
    id: number
    name: string
    total_price?: string
    financial_status?: string
  } | null
}> {
  const res = await apiFetch('/api/care-tasks/shopify-create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  return {
    orderId: data.orderId || null,
    orderName: data.orderName || null,
    payment: data.payment || body.payment,
    invoiceUrl: data.invoiceUrl || null,
    createdBy: data.createdBy || null,
    order: data.order || null,
  }
}

export interface CareCreatedOrderLine {
  title: string
  variantTitle: string | null
  sku: string | null
  quantity: number
  price: string
}

export interface CareCreatedOrder {
  id: string
  name: string
  created_at: string | null
  total_price: string
  currency: string
  financial_status: string | null
  fulfillment_status: string | null
  cancelled: boolean
  cancelled_at: string | null
  cancel_reason: string | null
  payment: 'cod' | 'prepaid'
  email: string | null
  phone: string | null
  customerName: string
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  zip: string | null
  country: string | null
  note: string | null
  tags: string[]
  lineItems: CareCreatedOrderLine[]
  createdByEmail: string | null
  createdByName: string | null
}

export interface CareCreatedOrdersSummary {
  total: number
  mine: number
  cod: number
  prepaid: number
  active: number
  cancelled: number
}

export async function fetchCareCreatedOrders(opts?: {
  mine?: boolean
  search?: string
  page?: number
  pageSize?: number
  payment?: 'all' | 'cod' | 'prepaid'
  status?: 'all' | 'active' | 'cancelled'
}): Promise<{
  orders: CareCreatedOrder[]
  summary: CareCreatedOrdersSummary
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}> {
  const qs = new URLSearchParams()
  if (opts?.mine) qs.set('mine', '1')
  if (opts?.search) qs.set('search', opts.search)
  if (opts?.page) qs.set('page', String(opts.page))
  if (opts?.pageSize) qs.set('pageSize', String(opts.pageSize))
  if (opts?.payment && opts.payment !== 'all') qs.set('payment', opts.payment)
  if (opts?.status && opts.status !== 'all') qs.set('status', opts.status)
  const query = qs.toString()
  const res = await apiFetch(`/api/care-tasks/created-orders${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  })
  const data = await parseJson(res)
  return {
    orders: Array.isArray(data.orders) ? data.orders : [],
    summary: data.summary || { total: 0, mine: 0, cod: 0, prepaid: 0, active: 0, cancelled: 0 },
    pagination: data.pagination || {
      page: 1,
      pageSize: opts?.pageSize || 20,
      total: 0,
      totalPages: 1,
    },
  }
}

export type { CareTask, CareTaskSummary, CareOrderGroup, ExecutivePerformance }
