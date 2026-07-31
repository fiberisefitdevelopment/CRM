/**
 * Salestrail Call Export API client (server-side).
 * Docs: https://www.salestrail.io/knowledge-base/how-to-use-salestrail-pull-api
 */

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

export interface CallQueryParams {
  from: string
  to: string
  byCreated?: boolean
}

export interface CallFilters {
  search?: string
  user?: string
  phone?: string
  answered?: 'true' | 'false' | 'all'
  direction?: 'inbound' | 'outbound' | 'all'
  integrated?: 'true' | 'false' | 'all'
  source?: string
  sourceDetail?: string
  hasRecording?: boolean
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

export class CustomerServiceApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CustomerServiceApiError'
    this.status = status
  }
}

const BASE_URL = () =>
  process.env.SALESTRAIL_API_BASE_URL || 'https://standalone-api.salestrail.io'

function getAuthHeader(): string {
  const username = process.env.SALESTRAIL_API_USERNAME
  const password = process.env.SALESTRAIL_API_PASSWORD
  if (!username || !password) {
    throw new CustomerServiceApiError(
      'Salestrail API credentials are not configured (SALESTRAIL_API_USERNAME / SALESTRAIL_API_PASSWORD).',
      500,
    )
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function salestrailFetch(
  path: string,
  init?: RequestInit & { expectRedirect?: boolean },
): Promise<Response> {
  const url = `${BASE_URL().replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: getAuthHeader(),
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
      signal: controller.signal,
      redirect: init?.expectRedirect ? 'manual' : 'follow',
    })
    return res
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new CustomerServiceApiError('Request to Salestrail API timed out.', 504)
    }
    throw new CustomerServiceApiError(
      err?.message || 'Network failure contacting Salestrail API.',
      502,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function mapHttpError(status: number, bodyText: string): CustomerServiceApiError {
  if (status === 401) return new CustomerServiceApiError('Unauthorized — check Salestrail API credentials.', 401)
  if (status === 403) return new CustomerServiceApiError('Forbidden — you do not have access to this Salestrail resource.', 403)
  if (status === 404) return new CustomerServiceApiError('Resource not found.', 404)
  if (status >= 500) return new CustomerServiceApiError(`Salestrail API error (${status}). ${bodyText.slice(0, 200)}`, 502)
  return new CustomerServiceApiError(bodyText || `Salestrail request failed (${status}).`, status)
}

function normalizeCall(raw: any): CallData {
  return {
    answered: Boolean(raw?.answered),
    callId: String(raw?.callId ?? raw?.call_id ?? ''),
    createdAt: String(raw?.createdAt ?? raw?.created_at ?? ''),
    duration: Number(raw?.duration ?? 0) || 0,
    formattedNumber: String(raw?.formattedNumber ?? raw?.formatted_number ?? ''),
    inbound: Boolean(raw?.inbound),
    integrated: Boolean(raw?.integrated),
    number: String(raw?.number ?? ''),
    phonebookName: String(raw?.phonebookName ?? raw?.phonebook_name ?? ''),
    recType: String(raw?.recType ?? raw?.rec_type ?? ''),
    recUrl: String(raw?.recUrl ?? raw?.rec_url ?? ''),
    source: String(raw?.source ?? ''),
    sourceDetail: String(raw?.sourceDetail ?? raw?.source_detail ?? ''),
    startTime: String(raw?.startTime ?? raw?.start_time ?? ''),
    userEmail: String(raw?.userEmail ?? raw?.user_email ?? ''),
    userId: String(raw?.userId ?? raw?.user_id ?? ''),
    userName: String(raw?.userName ?? raw?.user_name ?? ''),
    userPhone: String(raw?.userPhone ?? raw?.user_phone ?? ''),
    userTeams: Array.isArray(raw?.userTeams)
      ? raw.userTeams
      : Array.isArray(raw?.user_teams)
        ? raw.user_teams
        : [],
  }
}

function normalizeIntegration(raw: any): IntegrationData {
  return {
    callFormatted: String(raw?.callFormatted ?? raw?.call_formatted ?? ''),
    callId: String(raw?.callId ?? raw?.call_id ?? ''),
    callNumber: String(raw?.callNumber ?? raw?.call_number ?? ''),
    callStartTime: String(raw?.callStartTime ?? raw?.call_start_time ?? ''),
    integrationLogCreated: String(raw?.integrationLogCreated ?? raw?.integration_log_created ?? ''),
    integrationLogErrorMessage: String(
      raw?.integrationLogErrorMessage ?? raw?.integration_log_error_message ?? '',
    ),
    integrationLogStatus: String(raw?.integrationLogStatus ?? raw?.integration_log_status ?? ''),
    integrationLogUpdated: String(raw?.integrationLogUpdated ?? raw?.integration_log_updated ?? ''),
    userEmail: String(raw?.userEmail ?? raw?.user_email ?? ''),
    userId: String(raw?.userId ?? raw?.user_id ?? ''),
    userName: String(raw?.userName ?? raw?.user_name ?? ''),
    userPhone: String(raw?.userPhone ?? raw?.user_phone ?? ''),
  }
}

function parseJsonArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['calls', 'data', 'items', 'results', 'integrations', 'logs']) {
      if (Array.isArray(obj[key])) return obj[key] as any[]
    }
  }
  return []
}

// ─── Simple TTL cache ────────────────────────────────────────────────────────

type CacheEntry<T> = { expires: number; value: T }
const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 60_000

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.value as T
}

function setCached<T>(key: string, value: T) {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })
}

// ─── API methods ─────────────────────────────────────────────────────────────

export async function getCalls(params: CallQueryParams): Promise<CallData[]> {
  const { from, to, byCreated = false } = params
  const cacheKey = `calls:${byCreated ? 'created' : 'start'}:${from}:${to}`
  const cached = getCached<CallData[]>(cacheKey)
  if (cached) return cached

  const path = byCreated
    ? `/export/calls/byCreated/json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : `/export/calls/json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

  const res = await salestrailFetch(path)
  const text = await res.text().catch(() => '')
  if (!res.ok) throw mapHttpError(res.status, text)

  let data: unknown = []
  try {
    data = text ? JSON.parse(text) : []
  } catch {
    throw new CustomerServiceApiError('Invalid JSON from Salestrail calls API.', 502)
  }

  const calls = parseJsonArray(data).map(normalizeCall).filter((c) => c.callId)
  setCached(cacheKey, calls)
  return calls
}

export async function getCallsByCreated(from: string, to: string): Promise<CallData[]> {
  return getCalls({ from, to, byCreated: true })
}

export async function exportCallsCsv(params: CallQueryParams): Promise<string> {
  const { from, to, byCreated = false } = params
  const path = byCreated
    ? `/export/calls/byCreated/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : `/export/calls/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

  const res = await salestrailFetch(path, {
    headers: { Accept: 'text/csv, application/octet-stream, */*' },
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw mapHttpError(res.status, text)
  return text
}

export async function exportCallsCsvByCreated(from: string, to: string): Promise<string> {
  return exportCallsCsv({ from, to, byCreated: true })
}

async function fetchRecordingResponse(callId: string): Promise<Response> {
  // Must NOT send Accept: application/json — Salestrail returns a 302 to blob audio.
  return salestrailFetch(`/export/calls/${encodeURIComponent(callId)}/recording`, {
    expectRedirect: true,
    headers: { Accept: '*/*' },
  })
}

function extractUrlFromBody(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  try {
    const data = JSON.parse(trimmed)
    const candidate =
      data?.url ||
      data?.location ||
      data?.recordingUrl ||
      data?.recUrl ||
      data?.data?.url
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate
  } catch {
    // not JSON
  }
  return null
}

/**
 * Resolve the temporary blob URL for a call recording (Salestrail 302 Location).
 */
export async function getRecordingUrl(callId: string): Promise<string | null> {
  const res = await fetchRecordingResponse(callId)

  if (res.status === 404) return null

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('Location') || res.headers.get('location')
    if (location) return location
  }

  // Some runtimes expose the final URL after an opaque/auto redirect
  if (res.url && !res.url.includes('/export/calls/')) {
    return res.url
  }

  // Some environments return the URL in the body instead of a redirect
  const text = await res.text().catch(() => '')
  if (!res.ok && res.status !== 200) {
    // Fallback: follow redirects and use the final response URL
    try {
      const followed = await salestrailFetch(
        `/export/calls/${encodeURIComponent(callId)}/recording`,
        { headers: { Accept: '*/*' } },
      )
      if (followed.ok && followed.url && !followed.url.includes('/export/calls/')) {
        return followed.url
      }
      const followedText = await followed.text().catch(() => '')
      const fromBody = extractUrlFromBody(followedText)
      if (fromBody) return fromBody
    } catch {
      // ignore and throw original
    }
    throw mapHttpError(res.status, text)
  }

  const fromBody = extractUrlFromBody(text)
  if (fromBody) return fromBody

  // 200 with audio body and final URL on response
  if (res.ok && res.url && !res.url.includes('/export/calls/')) {
    return res.url
  }

  return null
}

/**
 * Fetch recording bytes. Salestrail returns 302 Location to blob storage.
 */
export async function getRecording(callId: string): Promise<{
  body: ArrayBuffer
  contentType: string
  location?: string
}> {
  // Prefer resolving blob URL, then downloading from storage
  try {
    const location = await getRecordingUrl(callId)
    if (location) {
      const audioRes = await fetch(location, {
        cache: 'no-store',
        redirect: 'follow',
        headers: { Accept: '*/*' },
      })

      if (audioRes.ok) {
        const body = await audioRes.arrayBuffer()
        if (body && body.byteLength > 0) {
          return {
            body,
            contentType: audioRes.headers.get('content-type') || 'audio/mpeg',
            location,
          }
        }
      }
    }
  } catch {
    // fall through to direct follow fetch
  }

  // Fallback: follow redirects from Salestrail and return the audio body
  const followed = await salestrailFetch(
    `/export/calls/${encodeURIComponent(callId)}/recording`,
    { headers: { Accept: '*/*' } },
  )

  if (followed.status === 404) {
    throw new CustomerServiceApiError('Recording not available.', 404)
  }
  if (!followed.ok) {
    const text = await followed.text().catch(() => '')
    throw mapHttpError(followed.status, text)
  }

  const contentType = followed.headers.get('content-type') || 'audio/mpeg'
  if (contentType.includes('application/json') || contentType.includes('text/')) {
    const text = await followed.text().catch(() => '')
    const url = extractUrlFromBody(text)
    if (url) {
      const audioRes = await fetch(url, { cache: 'no-store', redirect: 'follow', headers: { Accept: '*/*' } })
      if (!audioRes.ok) {
        throw new CustomerServiceApiError('Failed to download recording from storage.', audioRes.status)
      }
      const body = await audioRes.arrayBuffer()
      return { body, contentType: audioRes.headers.get('content-type') || 'audio/mpeg', location: url }
    }
    throw new CustomerServiceApiError('Recording not available.', 404)
  }

  const body = await followed.arrayBuffer()
  if (!body || body.byteLength === 0) {
    throw new CustomerServiceApiError('Recording file is empty.', 404)
  }

  return {
    body,
    contentType,
    location: followed.url && !followed.url.includes('/export/calls/') ? followed.url : undefined,
  }
}

export async function getIntegrationLogs(from: string, to: string): Promise<IntegrationData[]> {
  const cacheKey = `integration:${from}:${to}`
  const cached = getCached<IntegrationData[]>(cacheKey)
  if (cached) return cached

  const path = `/export/integration/json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const res = await salestrailFetch(path)
  const text = await res.text().catch(() => '')
  if (!res.ok) throw mapHttpError(res.status, text)

  let data: unknown = []
  try {
    data = text ? JSON.parse(text) : []
  } catch {
    throw new CustomerServiceApiError('Invalid JSON from Salestrail integration API.', 502)
  }

  const logs = parseJsonArray(data).map(normalizeIntegration)
  setCached(cacheKey, logs)
  return logs
}

// ─── Filtering / summarization helpers ───────────────────────────────────────

export function hasRecording(call: CallData): boolean {
  const url = (call.recUrl || '').trim()
  if (url) return true
  const recType = (call.recType || '').trim().toUpperCase()
  return Boolean(recType && recType !== 'NONE' && recType !== 'NULL')
}

export function filterCalls(calls: CallData[], filters: CallFilters = {}): CallData[] {
  const search = filters.search?.trim().toLowerCase()
  return calls.filter((call) => {
    if (filters.hasRecording && !hasRecording(call)) return false

    if (filters.answered === 'true' && !call.answered) return false
    if (filters.answered === 'false' && call.answered) return false

    if (filters.direction === 'inbound' && !call.inbound) return false
    if (filters.direction === 'outbound' && call.inbound) return false

    if (filters.integrated === 'true' && !call.integrated) return false
    if (filters.integrated === 'false' && call.integrated) return false

    if (filters.user) {
      const u = filters.user.toLowerCase()
      const match =
        call.userName.toLowerCase().includes(u) ||
        call.userEmail.toLowerCase().includes(u) ||
        call.userId.toLowerCase() === u
      if (!match) return false
    }

    if (filters.phone) {
      const p = filters.phone.replace(/\D/g, '')
      const hay = `${call.number}${call.formattedNumber}`.replace(/\D/g, '')
      if (p && !hay.includes(p)) return false
    }

    if (filters.source && !call.source.toLowerCase().includes(filters.source.toLowerCase())) {
      return false
    }

    if (
      filters.sourceDetail &&
      !call.sourceDetail.toLowerCase().includes(filters.sourceDetail.toLowerCase())
    ) {
      return false
    }

    if (search) {
      const blob = [
        call.callId,
        call.number,
        call.formattedNumber,
        call.phonebookName,
        call.userName,
        call.userEmail,
        call.source,
        call.sourceDetail,
      ]
        .join(' ')
        .toLowerCase()
      if (!blob.includes(search)) return false
    }

    return true
  })
}

export function sortCalls(
  calls: CallData[],
  sortBy: string = 'startTime',
  sortDir: 'asc' | 'desc' = 'desc',
): CallData[] {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...calls].sort((a, b) => {
    const av = (a as any)[sortBy]
    const bv = (b as any)[sortBy]
    if (typeof av === 'boolean' && typeof bv === 'boolean') {
      return (Number(av) - Number(bv)) * dir
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? '')) * dir
  })
}

export function paginateCalls<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page)
  const safeSize = Math.min(Math.max(1, pageSize), 200)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / safeSize))
  const start = (safePage - 1) * safeSize
  return {
    items: items.slice(start, start + safeSize),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages,
  }
}

export function summarizeCalls(calls: CallData[]): CallSummary {
  const totalCalls = calls.length
  const answeredCalls = calls.filter((c) => c.answered).length
  const missedCalls = totalCalls - answeredCalls
  const inboundCalls = calls.filter((c) => c.inbound).length
  const outboundCalls = totalCalls - inboundCalls
  const integratedCalls = calls.filter((c) => c.integrated).length
  const durationSum = calls.reduce((sum, c) => sum + (c.duration || 0), 0)
  const averageCallDuration = totalCalls > 0 ? Math.round(durationSum / totalCalls) : 0
  const totalRecordings = calls.filter(hasRecording).length

  return {
    totalCalls,
    answeredCalls,
    missedCalls,
    inboundCalls,
    outboundCalls,
    integratedCalls,
    averageCallDuration,
    totalRecordings,
  }
}

export function buildCallAnalytics(calls: CallData[]) {
  const summary = summarizeCalls(calls)
  const answeredPct = summary.totalCalls
    ? Math.round((summary.answeredCalls / summary.totalCalls) * 100)
    : 0
  const missedPct = summary.totalCalls
    ? Math.round((summary.missedCalls / summary.totalCalls) * 100)
    : 0

  const byDay = new Map<string, number>()
  const byHour = new Map<number, number>()
  const byWeek = new Map<string, number>()
  const byMonth = new Map<string, number>()
  const durationByDay = new Map<string, { sum: number; count: number }>()
  const userCounts = new Map<string, number>()
  const durationBuckets = [
    { name: '0-30s', min: 0, max: 30, value: 0 },
    { name: '30-60s', min: 30, max: 60, value: 0 },
    { name: '1-3m', min: 60, max: 180, value: 0 },
    { name: '3-5m', min: 180, max: 300, value: 0 },
    { name: '5m+', min: 300, max: Infinity, value: 0 },
  ]

  for (const call of calls) {
    const d = call.startTime || call.createdAt
    const date = d ? new Date(d) : null
    if (date && !Number.isNaN(date.getTime())) {
      const dayKey = date.toISOString().slice(0, 10)
      byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1)

      const hour = date.getUTCHours()
      byHour.set(hour, (byHour.get(hour) || 0) + 1)

      const weekStart = new Date(date)
      weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay())
      const weekKey = weekStart.toISOString().slice(0, 10)
      byWeek.set(weekKey, (byWeek.get(weekKey) || 0) + 1)

      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
      byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1)

      const durEntry = durationByDay.get(dayKey) || { sum: 0, count: 0 }
      durEntry.sum += call.duration || 0
      durEntry.count += 1
      durationByDay.set(dayKey, durEntry)
    }

    const userKey = call.userName || call.userEmail || 'Unknown'
    userCounts.set(userKey, (userCounts.get(userKey) || 0) + 1)

    const bucket = durationBuckets.find(
      (b) => (call.duration || 0) >= b.min && (call.duration || 0) < b.max,
    )
    if (bucket) bucket.value += 1
  }

  const toSeries = (map: Map<string, number>) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value }))

  const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
    name: `${String(hour).padStart(2, '0')}:00`,
    value: byHour.get(hour) || 0,
  }))

  const averageDurationTrend = [...durationByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { sum, count }]) => ({
      name,
      value: count ? Math.round(sum / count) : 0,
    }))

  const topUsers = [...userCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }))

  return {
    kpis: {
      ...summary,
      answeredPct,
      missedPct,
    },
    callsPerDay: toSeries(byDay),
    answeredVsMissed: [
      { name: 'Answered', value: summary.answeredCalls },
      { name: 'Missed', value: summary.missedCalls },
    ],
    inboundVsOutbound: [
      { name: 'Inbound', value: summary.inboundCalls },
      { name: 'Outbound', value: summary.outboundCalls },
    ],
    averageDurationTrend,
    topUsers,
    hourlyDistribution,
    weeklyTrend: toSeries(byWeek),
    monthlyTrend: toSeries(byMonth),
    durationHistogram: durationBuckets.map(({ name, value }) => ({ name, value })),
  }
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

export function defaultDateRange(days = 30): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  from.setUTCHours(0, 0, 0, 0)
  to.setUTCHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function dateInputToIso(dateStr: string, endOfDay = false): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) return new Date(dateStr).toISOString()
  const iso = endOfDay ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`
  return new Date(iso).toISOString()
}
