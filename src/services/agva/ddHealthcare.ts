import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

export interface DdHealthcareCallRow {
  id: string
  agentEmail: string
  callLogId: string
  phone: string
  name: string
  location: string
  category: string
  serviceType: string
  direction: string
  durationSec: number | null
  feedback: string
  recordingUrl: string
  recordingStoragePath: string
  localRecordingPath: string
  createdAt: string | null
  updatedAt: string | null
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function pickString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function pickNumber(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  if (typeof value === 'object' && value !== null) {
    const ts = value as { toDate?: () => Date; _seconds?: number }
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString()
    if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000).toISOString()
  }
  return null
}

function storageBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim()
  const parts = normalized.split('/')
  return parts[parts.length - 1] || ''
}

async function loadRecordingUrlMaps() {
  const snap = await getDb().collection('ddHealthcareRecordings').get()
  const byDocId = new Map<string, string>()
  const byCallId = new Map<string, string>()
  const byFileName = new Map<string, string>()

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const url = pickString(data, [
      'recordingUrl',
      'url',
      'audioUrl',
      'downloadUrl',
      'link',
      'fileUrl',
      'storageUrl',
      'recordingLink',
    ])
    if (!url) continue
    byDocId.set(doc.id, url)
    const callId = pickString(data, ['callId', 'call_id', 'callLogId', 'healthcareCallId', 'ddHealthcareCallId'])
    if (callId) byCallId.set(callId, url)
    const storagePath = pickString(data, ['recordingStoragePath', 'storagePath', 'path'])
    const base = storageBasename(storagePath || doc.id)
    if (base) byFileName.set(base, url)
  }

  return { byDocId, byCallId, byFileName }
}

function resolveRecordingUrl(
  id: string,
  data: Record<string, unknown>,
  recordings: {
    byDocId: Map<string, string>
    byCallId: Map<string, string>
    byFileName: Map<string, string>
  },
): string {
  const inline = pickString(data, [
    'recordingUrl',
    'recordingLink',
    'recording_url',
    'audioUrl',
    'audio_url',
  ])
  if (inline) return inline

  const callLogId = pickString(data, ['callLogId', 'call_log_id'])
  if (callLogId && recordings.byCallId.get(callLogId)) {
    return recordings.byCallId.get(callLogId)!
  }

  const recordingId = pickString(data, ['recordingId', 'recording_id', 'ddHealthcareRecordingId'])
  if (recordingId && recordings.byDocId.get(recordingId)) {
    return recordings.byDocId.get(recordingId)!
  }

  const storagePath = pickString(data, ['recordingStoragePath', 'recording_storage_path'])
  const base = storageBasename(storagePath)
  if (base && recordings.byFileName.get(base)) {
    return recordings.byFileName.get(base)!
  }

  return recordings.byCallId.get(id) || recordings.byDocId.get(id) || ''
}

function mapCallDoc(
  id: string,
  data: Record<string, unknown>,
  recordings: {
    byDocId: Map<string, string>
    byCallId: Map<string, string>
    byFileName: Map<string, string>
  },
): DdHealthcareCallRow {
  return {
    id,
    agentEmail: pickString(data, ['agentEmail', 'agent_email', 'executiveEmail']),
    callLogId: pickString(data, ['callLogId', 'call_log_id', 'callId']),
    phone: pickString(data, ['phone', 'phoneNumber', 'mobile', 'callerPhone', 'customerPhone']),
    name: pickString(data, ['name', 'customerName', 'callerName', 'patientName']),
    location: pickString(data, ['location', 'city', 'address', 'area', 'state']),
    category: pickString(data, ['category', 'callCategory', 'type', 'callType']),
    serviceType: pickString(data, ['serviceType', 'service_type', 'service']),
    direction: pickString(data, ['direction', 'callDirection']),
    durationSec: pickNumber(data, ['durationSec', 'duration_sec', 'duration', 'callDurationSec']),
    feedback: pickString(data, ['feedback', 'notes', 'remarks', 'comment', 'summary']),
    recordingUrl: resolveRecordingUrl(id, data, recordings),
    recordingStoragePath: pickString(data, ['recordingStoragePath', 'recording_storage_path']),
    localRecordingPath: pickString(data, ['localRecordingPath', 'local_recording_path']),
    createdAt: timestampToIso(data.createdAt) || timestampToIso(data.timestamp) || timestampToIso(data.calledAt),
    updatedAt: timestampToIso(data.updatedAt),
  }
}

export type AgvaCallTypeFilter = 'all' | 'service' | 'sales_enquiry' | 'spam'
export type AgvaDateRangeFilter = 'all' | 'today' | '7d' | '30d' | 'custom'

export interface ListDdHealthcareCallsParams {
  page: number
  perPage: number
  search?: string
  callType?: AgvaCallTypeFilter
  location?: string
  dateRange?: AgvaDateRangeFilter
  dateFrom?: string
  dateTo?: string
}

export interface DdHealthcareCallFacets {
  locations: string[]
}

function rowSearchBlob(row: DdHealthcareCallRow): string {
  return [
    row.id,
    row.agentEmail,
    row.callLogId,
    row.phone,
    row.name,
    row.location,
    row.category,
    row.serviceType,
    row.direction,
    row.feedback,
    row.recordingStoragePath,
  ]
    .join(' ')
    .toLowerCase()
}

function matchesSearch(row: DdHealthcareCallRow, rawSearch: string): boolean {
  const search = rawSearch.trim().toLowerCase()
  if (!search) return true

  const terms = search.split(/\s+/).filter(Boolean)
  const haystack = rowSearchBlob(row)
  const phoneDigits = row.phone.replace(/\D/g, '')

  return terms.every((term) => {
    if (haystack.includes(term)) return true
    const termDigits = term.replace(/\D/g, '')
    if (termDigits.length >= 2 && phoneDigits.includes(termDigits)) return true
    return false
  })
}

function parseDayStart(isoDate: string): number | null {
  const d = new Date(`${isoDate}T00:00:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function parseDayEnd(isoDate: string): number | null {
  const d = new Date(`${isoDate}T23:59:59.999+05:30`)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function istCalendarDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date)
}

/** Maps Firestore serviceType/category to filter bucket. */
export function classifyCallType(
  row: DdHealthcareCallRow,
): 'service' | 'sales_enquiry' | 'spam' | 'other' {
  const blob = `${row.serviceType} ${row.category}`.toLowerCase().replace(/_/g, ' ')
  if (/\bspam\b/.test(blob)) return 'spam'
  if (blob.includes('sales')) return 'sales_enquiry'
  if (blob.includes('service')) return 'service'
  return 'other'
}

function getDateRangeBounds(
  dateRange?: AgvaDateRangeFilter,
  dateFrom?: string,
  dateTo?: string,
): { start: number | null; end: number | null } {
  if (!dateRange || dateRange === 'all') {
    return { start: null, end: null }
  }

  const todayKey = istCalendarDate()

  if (dateRange === 'today') {
    return {
      start: parseDayStart(todayKey),
      end: parseDayEnd(todayKey),
    }
  }

  if (dateRange === '7d' || dateRange === '30d') {
    const days = dateRange === '7d' ? 7 : 30
    const end = parseDayEnd(todayKey)
    const startOfToday = parseDayStart(todayKey)
    if (end == null || startOfToday == null) return { start: null, end: null }
    const start = startOfToday - (days - 1) * 24 * 60 * 60 * 1000
    return { start, end }
  }

  if (dateRange === 'custom') {
    return {
      start: dateFrom ? parseDayStart(dateFrom) : null,
      end: dateTo ? parseDayEnd(dateTo) : null,
    }
  }

  return { start: null, end: null }
}

function matchesFilters(row: DdHealthcareCallRow, f: ListDdHealthcareCallsParams): boolean {
  if (f.callType && f.callType !== 'all') {
    if (classifyCallType(row) !== f.callType) return false
  }

  if (f.location && row.location.toLowerCase() !== f.location.toLowerCase()) {
    return false
  }

  const { start, end } = getDateRangeBounds(f.dateRange, f.dateFrom, f.dateTo)
  if (start != null || end != null) {
    const ts = row.createdAt ? Date.parse(row.createdAt) : NaN
    if (Number.isNaN(ts)) return false
    if (start != null && ts < start) return false
    if (end != null && ts > end) return false
  }

  return true
}

function buildFacets(rows: DdHealthcareCallRow[]): DdHealthcareCallFacets {
  const locations = [...new Set(rows.map((r) => r.location.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  return { locations }
}

export async function listDdHealthcareCalls(
  params: ListDdHealthcareCallsParams,
): Promise<{ calls: DdHealthcareCallRow[]; total: number; facets: DdHealthcareCallFacets }> {
  const page = Math.max(1, params.page)
  const perPage = Math.min(100, Math.max(1, params.perPage))

  const recordings = await loadRecordingUrlMaps()
  const col = getDb().collection('ddHealthcareCalls')

  let docs: admin.firestore.QueryDocumentSnapshot[] = []
  const orderFields = ['createdAt', 'timestamp', 'calledAt'] as const
  for (const field of orderFields) {
    try {
      const snap = await col.orderBy(field, 'desc').get()
      docs = snap.docs
      if (docs.length > 0) break
    } catch {
      // missing index or field — try next
    }
  }
  if (docs.length === 0) {
    const snap = await col.get()
    docs = snap.docs
  }

  let rows = docs
    .map((doc) => mapCallDoc(doc.id, doc.data() as Record<string, unknown>, recordings))
    .sort((a, b) => {
      const aTs = a.createdAt ? Date.parse(a.createdAt) : 0
      const bTs = b.createdAt ? Date.parse(b.createdAt) : 0
      if (bTs !== aTs) return bTs - aTs
      return b.id.localeCompare(a.id)
    })

  const facets = buildFacets(rows)

  let filtered = rows.filter((row) => matchesFilters(row, params))
  const search = params.search?.trim() || ''
  if (search) {
    filtered = filtered.filter((row) => matchesSearch(row, search))
  }

  const total = filtered.length
  const start = (page - 1) * perPage
  const calls = filtered.slice(start, start + perPage)
  return { calls, total, facets }
}
