/**
 * Customer-service call logs from Firestore `counters` (cs_call_* device recordings).
 */

import {
  downloadDeviceRecording,
  getDeviceRecordingById,
  getDeviceRecordingSignedUrl,
  listDeviceRecordingsInRange,
  type DeviceCallRecording,
} from '@/src/services/careTasks/deviceRecordings'

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
  /** CRM customer name resolved by phone match */
  customerName?: string
  /** Shopify/Shiprocket order id resolved by phone match */
  orderId?: string
  /** Human-facing order name (e.g. #1128) resolved by phone match */
  orderName?: string
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

function toCallData(row: DeviceCallRecording): CallData {
  const phone = row.phone || ''
  return {
    answered: row.answered,
    callId: row.id || row.callLogId,
    createdAt: row.createdAt || row.startTime || '',
    duration: row.durationSec || 0,
    formattedNumber: phone,
    inbound: row.direction === 'inbound',
    integrated: Boolean(row.orderId || row.orderName),
    number: phone,
    phonebookName: row.customerName || '',
    recType: row.hasRecording ? 'device' : 'none',
    recUrl: row.firebaseStoragePath || '',
    source: row.platform || 'device',
    sourceDetail: row.orderName || row.orderId || '',
    startTime: row.startTime || row.createdAt || '',
    userEmail: row.userEmail || '',
    userId: row.userId || '',
    userName: row.userName || '',
    userPhone: row.userPhone || '',
    userTeams: [],
    customerName: row.customerName || undefined,
    orderId: row.orderId || undefined,
    orderName: row.orderName || undefined,
  }
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

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

export async function getCalls(params: CallQueryParams): Promise<CallData[]> {
  const { from, to } = params
  const cacheKey = `calls:counters:${from}:${to}`
  const cached = getCached<CallData[]>(cacheKey)
  if (cached) return cached

  const rows = await listDeviceRecordingsInRange(from, to)
  const calls = rows.map(toCallData).filter((c) => c.callId)
  setCached(cacheKey, calls)
  return calls
}

export async function getCallsByCreated(from: string, to: string): Promise<CallData[]> {
  return getCalls({ from, to, byCreated: true })
}

export async function exportCallsCsv(params: CallQueryParams): Promise<string> {
  const calls = await getCalls(params)
  const headers = [
    'callId',
    'number',
    'customerName',
    'orderName',
    'orderId',
    'userName',
    'userEmail',
    'startTime',
    'createdAt',
    'duration',
    'answered',
    'inbound',
    'integrated',
    'source',
    'sourceDetail',
  ]
  return [
    headers.join(','),
    ...calls.map((c) =>
      [
        c.callId,
        c.number,
        c.customerName || c.phonebookName,
        c.orderName,
        c.orderId,
        c.userName,
        c.userEmail,
        c.startTime,
        c.createdAt,
        c.duration,
        c.answered,
        c.inbound,
        c.integrated,
        c.source,
        c.sourceDetail,
      ]
        .map(csvEscape)
        .join(','),
    ),
  ].join('\n')
}

export async function exportCallsCsvByCreated(from: string, to: string): Promise<string> {
  return exportCallsCsv({ from, to, byCreated: true })
}

export async function getRecordingUrl(callId: string): Promise<string | null> {
  const recording = await getDeviceRecordingById(callId)
  if (!recording?.hasRecording) return null
  return getDeviceRecordingSignedUrl(recording)
}

export async function getRecording(callId: string): Promise<{
  body: ArrayBuffer
  contentType: string
  location?: string
}> {
  const recording = await getDeviceRecordingById(callId)
  if (!recording?.hasRecording) {
    throw new CustomerServiceApiError('Recording not available.', 404)
  }
  try {
    const { body, contentType } = await downloadDeviceRecording(recording)
    const bytes = new Uint8Array(body)
    return { body: bytes.buffer, contentType }
  } catch (error: any) {
    const status = error?.status || 500
    throw new CustomerServiceApiError(error?.message || 'Recording not available.', status)
  }
}

export async function getIntegrationLogs(_from: string, _to: string): Promise<IntegrationData[]> {
  return []
}

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
        call.customerName,
        call.orderName,
        call.orderId,
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
