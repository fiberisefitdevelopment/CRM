export interface CallData {
  answered: boolean
  callId: string
  createdAt: string
  duration: number
  formattedNumber: string
  inbound: boolean
  integrated: boolean
  number: string
  phonebookName: string
  recType: string
  recUrl: string
  source: string
  sourceDetail: string
  startTime: string
  userEmail: string
  userId: string
  userName: string
  userPhone: string
  userTeams: Record<string, string>[]
}

export interface IntegrationData {
  callFormatted: string
  callId: string
  callNumber: string
  callStartTime: string
  integrationLogCreated: string
  integrationLogErrorMessage: string
  integrationLogStatus: string
  integrationLogUpdated: string
  userEmail: string
  userId: string
  userName: string
  userPhone: string
}

export interface CallSummary {
  totalCalls: number
  answeredCalls: number
  missedCalls: number
  inboundCalls: number
  outboundCalls: number
  integratedCalls: number
  averageCallDuration: number
  totalRecordings: number
}

export interface CallsListResponse {
  calls: CallData[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  summary?: CallSummary
}

export interface CallFiltersQuery {
  from: string
  to: string
  byCreated?: boolean
  page?: number
  pageSize?: number
  search?: string
  user?: string
  phone?: string
  answered?: string
  direction?: string
  integrated?: string
  source?: string
  sourceDetail?: string
  hasRecording?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  includeSummary?: boolean
}

export class CustomerServiceClientError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CustomerServiceClientError'
    this.status = status
  }
}

function errorMessageForStatus(status: number, fallback: string): string {
  if (status === 401) return 'Unauthorized. Please sign in again.'
  if (status === 403) return 'You do not have permission to access this resource.'
  if (status === 404) return 'Resource not found.'
  if (status === 504) return 'Request timed out. Try a smaller date range.'
  if (status >= 500) return 'Server error. Please try again shortly.'
  return fallback
}

async function parseJson(response: Response) {
  return response.json().catch(() => ({}))
}

async function handleError(response: Response, fallback: string): Promise<never> {
  const data = await parseJson(response)
  const message = errorMessageForStatus(
    response.status,
    data.error || data.message || fallback,
  )
  throw new CustomerServiceClientError(message, response.status)
}

function buildParams(query: Record<string, string | number | boolean | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return params
}

export async function fetchCalls(query: CallFiltersQuery): Promise<CallsListResponse> {
  const params = buildParams({
    from: query.from,
    to: query.to,
    byCreated: query.byCreated ? 'true' : undefined,
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    user: query.user,
    phone: query.phone,
    answered: query.answered,
    direction: query.direction,
    integrated: query.integrated,
    source: query.source,
    sourceDetail: query.sourceDetail,
    hasRecording: query.hasRecording ? 'true' : undefined,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    includeSummary: query.includeSummary ? 'true' : undefined,
  })

  let response: Response
  try {
    response = await fetch(`/api/customer-service/calls?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }

  if (!response.ok) await handleError(response, 'Failed to fetch calls')
  return parseJson(response)
}

export async function fetchDashboard(from: string, to: string) {
  const params = buildParams({ from, to, includeSummary: true, page: 1, pageSize: 20, sortBy: 'startTime', sortDir: 'desc' })
  let response: Response
  try {
    response = await fetch(`/api/customer-service/dashboard?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }
  if (!response.ok) await handleError(response, 'Failed to load dashboard')
  return parseJson(response)
}

export async function fetchAnalytics(from: string, to: string) {
  const params = buildParams({ from, to })
  let response: Response
  try {
    response = await fetch(`/api/customer-service/analytics?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }
  if (!response.ok) await handleError(response, 'Failed to load analytics')
  return parseJson(response)
}

export async function fetchIntegrationLogs(query: {
  from: string
  to: string
  page?: number
  pageSize?: number
  search?: string
  status?: string
  user?: string
}) {
  const params = buildParams(query as any)
  let response: Response
  try {
    response = await fetch(`/api/customer-service/integration?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }
  if (!response.ok) await handleError(response, 'Failed to fetch integration logs')
  return parseJson(response)
}

/**
 * Recording stream URL via CRM proxy (authenticated server-side).
 * Salestrail `recUrl` is an API endpoint that requires Basic auth — never use it
 * directly in <audio src> or browser download.
 */
export function getRecordingStreamUrl(
  callId: string,
  mode: 'redirect' | 'proxy' | 'url' = 'proxy',
): string {
  return `/api/customer-service/calls/${encodeURIComponent(callId)}/recording?mode=${mode}`
}

/** True blob/CDN URL only — not the Salestrail /export/calls/.../recording API path. */
export function isDirectRecordingUrl(url?: string | null): boolean {
  const value = (url || '').trim()
  if (!/^https?:\/\//i.test(value)) return false
  if (/\/export\/calls\//i.test(value)) return false
  if (/standalone-api\.salestrail\.io/i.test(value)) return false
  return true
}

export function getPlayableRecordingSrc(call: { callId: string; recUrl?: string }): string {
  if (isDirectRecordingUrl(call.recUrl)) return call.recUrl!.trim()
  // Proxy is most reliable in the browser (auth + correct content-type)
  return getRecordingStreamUrl(call.callId, 'proxy')
}

export async function resolveRecordingUrl(callId: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(getRecordingStreamUrl(callId, 'url'), { cache: 'no-store' })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }
  if (!response.ok) await handleError(response, 'Recording not available')
  const data = await parseJson(response)
  if (!data?.url) throw new CustomerServiceClientError('Recording not available.', 404)
  return String(data.url)
}

export async function downloadCallsCsv(query: {
  from: string
  to: string
  byCreated?: boolean
  filtered?: boolean
  search?: string
  user?: string
  phone?: string
  answered?: string
  direction?: string
  integrated?: string
  source?: string
  sourceDetail?: string
}) {
  const params = buildParams({
    ...query,
    byCreated: query.byCreated ? 'true' : undefined,
    filtered: query.filtered ? 'true' : undefined,
  })

  let response: Response
  try {
    response = await fetch(`/api/customer-service/calls/csv?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new CustomerServiceClientError('Network failure. Check your connection.', 0)
  }

  if (!response.ok) await handleError(response, 'Failed to export CSV')

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `calls-export-${query.from.slice(0, 10)}-${query.to.slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function formatDateTime(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function defaultRangeDays(days = 30): { fromDate: string; toDate: string } {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { fromDate: toDateInputValue(from), toDate: toDateInputValue(to) }
}

export function dateRangeToIso(fromDate: string, toDate: string) {
  return {
    from: `${fromDate}T00:00:00.000Z`,
    to: `${toDate}T23:59:59.999Z`,
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
