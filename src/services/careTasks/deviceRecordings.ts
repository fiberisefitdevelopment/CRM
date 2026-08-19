import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { phoneMatchKey } from '@/src/utils/phoneNormalize'
import { isAdminRole } from '@/src/utils/accessControl'
import { normalizeCareExecutiveEmail } from './executiveConfig'

const COUNTERS_COL = 'counters'
const MAX_RECORDINGS = 50

export interface DeviceCallRecording {
  id: string
  callLogId: string
  phone: string
  customerName: string
  direction: 'inbound' | 'outbound' | string
  durationSec: number
  firebaseStoragePath: string
  hasRecording: boolean
  orderId: string
  orderName: string
  platform: string
  createdAt: string | null
  startTime: string | null
  answered: boolean
  userName: string
  userEmail: string
  userPhone: string
  userId: string
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

function toIso(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'object') {
    const rec = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof rec.toDate === 'function') {
      try {
        return rec.toDate().toISOString()
      } catch {
        return null
      }
    }
    const seconds = rec._seconds ?? rec.seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return null
}

function normalizeDirection(raw: unknown): string {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'incoming' || v === 'inbound' || v === 'in') return 'inbound'
  if (v === 'outgoing' || v === 'outbound' || v === 'out') return 'outbound'
  return v || 'outbound'
}

function isCallRecordingDoc(id: string, data: Record<string, unknown>): boolean {
  if (id.startsWith('cs_call_')) return true
  if (data.callLogId || data.firebaseStoragePath) return true
  return false
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const s = String(value || '').trim()
    if (s) return s
  }
  return ''
}

function serializeRecording(id: string, data: Record<string, any>): DeviceCallRecording | null {
  if (!isCallRecordingDoc(id, data)) return null
  const storagePath = String(data.firebaseStoragePath || '').replace(/^\/+/, '').trim()
  const phone = phoneMatchKey(data.normalizedPhone || data.phoneNumber || data.phone)
  const createdAt =
    toIso(data.createdAt) ||
    toIso(data.uploadedAt) ||
    toIso(data.recordedAt) ||
    toIso(data.startedAt) ||
    toIso(data.timestamp) ||
    toIso(data.createdAtTs) ||
    toIso(data.callTime) ||
    null
  const startTime = toIso(data.startTime) || createdAt
  const durationSec = Number(data.durationSec || data.duration || 0) || 0
  const assigned = data.assignedTo && typeof data.assignedTo === 'object' ? data.assignedTo : {}

  return {
    id,
    callLogId: String(data.callLogId || id.replace(/^cs_call_/, '') || id),
    phone,
    customerName: pickString(data.customerName, data.phonebookName),
    direction: normalizeDirection(data.direction),
    durationSec,
    firebaseStoragePath: storagePath,
    hasRecording: Boolean(storagePath),
    orderId: String(data.orderId || ''),
    orderName: String(data.orderName || ''),
    platform: String(data.platform || ''),
    createdAt,
    startTime,
    answered:
      typeof data.answered === 'boolean' ? data.answered : durationSec > 0,
    userName: pickString(
      data.userName,
      data.agentName,
      data.executiveName,
      data.createdByName,
      data.callerName,
      data.careExecutiveName,
      assigned.name,
    ),
    userEmail: pickString(
      data.userEmail,
      data.agentEmail,
      data.executiveEmail,
      data.createdByEmail,
      assigned.email,
    ),
    userPhone: pickString(data.userPhone, data.agentPhone, assigned.phone),
    userId: pickString(data.userId, data.agentId, data.executiveId, assigned.userId, assigned.id),
  }
}

function phoneQueryValues(key: string): string[] {
  const values = new Set<string>([key])
  if (key.length === 10) {
    values.add(`91${key}`)
    values.add(`+91${key}`)
  }
  return [...values]
}

function uniqueRecordings(rows: DeviceCallRecording[]): DeviceCallRecording[] {
  const seen = new Set<string>()
  const out: DeviceCallRecording[] = []
  for (const row of rows) {
    const k = row.id || row.callLogId
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }
  return out
}

function sortRecordings(rows: DeviceCallRecording[]): DeviceCallRecording[] {
  return [...rows].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    if (ta !== tb) return tb - ta
    const na = Number(a.callLogId) || 0
    const nb = Number(b.callLogId) || 0
    return nb - na
  })
}

async function queryCountersByField(field: string, values: string[]) {
  const db = getDb()
  const snaps = await Promise.all(
    values.map((value) =>
      db.collection(COUNTERS_COL).where(field, '==', value).limit(MAX_RECORDINGS).get(),
    ),
  )
  return snaps.flatMap((snap) => snap.docs)
}

export async function listDeviceRecordingsByPhone(
  phone: string,
  opts?: { orderId?: string | null },
): Promise<DeviceCallRecording[]> {
  const key = phoneMatchKey(phone)
  if (!key) return []

  const orderId = String(opts?.orderId || '').trim()
  const values = phoneQueryValues(key)
  let docs: admin.firestore.QueryDocumentSnapshot[] = []
  try {
    const jobs: Promise<admin.firestore.QueryDocumentSnapshot[]>[] = [
      queryCountersByField('normalizedPhone', values),
      queryCountersByField('phoneNumber', values),
    ]
    if (orderId) {
      jobs.push(
        getDb()
          .collection(COUNTERS_COL)
          .where('orderId', '==', orderId)
          .limit(MAX_RECORDINGS)
          .get()
          .then((snap) => snap.docs),
      )
    }
    docs = (await Promise.all(jobs)).flat()
  } catch (err: any) {
    console.warn('deviceRecordings: counters query failed', err?.message || err)
    return []
  }

  const seenIds = new Set<string>()
  const rows: DeviceCallRecording[] = []
  for (const doc of docs) {
    if (seenIds.has(doc.id)) continue
    seenIds.add(doc.id)
    const serialized = serializeRecording(doc.id, doc.data() || {})
    if (!serialized?.hasRecording) continue
    const phoneOk = phoneMatchKey(serialized.phone) === key
    const orderOk =
      Boolean(orderId) &&
      (serialized.orderId === orderId || serialized.orderName === orderId)
    if (!phoneOk && !orderOk) continue
    if (!serialized.createdAt) {
      serialized.createdAt = toIso(doc.createTime) || toIso(doc.updateTime)
    }
    rows.push(serialized)
  }

  const sorted = sortRecordings(uniqueRecordings(rows)).slice(0, MAX_RECORDINGS)
  if (!orderId) return sorted

  const matched = sorted.filter(
    (row) => row.orderId === orderId || row.orderName === orderId,
  )
  const rest = sorted.filter((row) => !matched.includes(row))
  return [...matched, ...rest]
}

const CALL_ID_PREFIX = 'cs_call_'
const LIST_PAGE_SIZE = 400
const LIST_MAX_DOCS = 8000

export async function listDeviceRecordingsInRange(
  fromIso: string,
  toIsoStr: string,
): Promise<DeviceCallRecording[]> {
  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIsoStr).getTime()
  const hasRange = Number.isFinite(fromMs) && Number.isFinite(toMs)
  const db = getDb()
  const rows: DeviceCallRecording[] = []
  let last: admin.firestore.QueryDocumentSnapshot | undefined

  try {
    while (rows.length < LIST_MAX_DOCS) {
      let query: admin.firestore.Query = db
        .collection(COUNTERS_COL)
        .orderBy(admin.firestore.FieldPath.documentId())
        .endAt(`${CALL_ID_PREFIX}\uf8ff`)
        .limit(LIST_PAGE_SIZE)
      query = last ? query.startAfter(last) : query.startAt(CALL_ID_PREFIX)

      const snap = await query.get()
      if (snap.empty) break

      for (const doc of snap.docs) {
        const serialized = serializeRecording(doc.id, doc.data() || {})
        if (!serialized) continue
        if (!serialized.createdAt) {
          serialized.createdAt = toIso(doc.createTime) || toIso(doc.updateTime)
          if (!serialized.startTime) serialized.startTime = serialized.createdAt
        }
        if (hasRange) {
          const stamp = serialized.startTime || serialized.createdAt
          const t = stamp ? new Date(stamp).getTime() : NaN
          if (Number.isFinite(t) && (t < fromMs || t > toMs)) continue
        }
        rows.push(serialized)
      }

      last = snap.docs[snap.docs.length - 1]
      if (snap.size < LIST_PAGE_SIZE) break
      if (!String(last.id).startsWith(CALL_ID_PREFIX)) break
    }
  } catch (err: any) {
    console.warn('deviceRecordings: range listing failed', err?.message || err)
  }

  return sortRecordings(uniqueRecordings(rows))
}

export async function getDeviceRecordingById(
  id: string,
): Promise<DeviceCallRecording | null> {
  const raw = String(id || '').trim()
  if (!raw) return null
  const candidates = raw.startsWith('cs_call_') ? [raw] : [raw, `cs_call_${raw}`]
  const db = getDb()
  for (const docId of candidates) {
    const snap = await db.collection(COUNTERS_COL).doc(docId).get()
    if (!snap.exists) continue
    const serialized = serializeRecording(snap.id, snap.data() || {})
    if (serialized?.hasRecording) return serialized
  }
  return null
}

export async function assertCanAccessDeviceRecordings(
  session: { email: string; role?: string | null },
  opts: { phone?: string | null; orderId?: string | null },
): Promise<void> {
  if (isAdminRole(session.role)) return

  const forbidden = () => {
    const err = new Error('Forbidden') as Error & { status: number }
    err.status = 403
    throw err
  }

  const email = normalizeCareExecutiveEmail(session.email)
  if (!email) forbidden()

  const db = getDb()
  const phoneKey = phoneMatchKey(opts.phone)
  const orderId = String(opts.orderId || '').trim()

  const queries: Promise<admin.firestore.QuerySnapshot>[] = []
  if (phoneKey) {
    queries.push(db.collection('careTasks').where('phone', '==', phoneKey).limit(40).get())
  }
  if (orderId) {
    queries.push(db.collection('careTasks').where('orderId', '==', orderId).limit(40).get())
  }
  if (!queries.length) forbidden()

  const snaps = await Promise.all(queries)
  const mine = snaps.some((snap) =>
    snap.docs.some((doc) => {
      const assigned = normalizeCareExecutiveEmail(doc.data()?.assignedTo?.email)
      return assigned === email
    }),
  )
  if (!mine) forbidden()
}

function storageBucketNames(): string[] {
  const app = getFirebaseAdmin()
  const projectId = process.env.FIREBASE_PROJECT_ID || app.options.projectId || ''
  return [
    ...new Set(
      [
        process.env.FIREBASE_STORAGE_BUCKET,
        projectId ? `${projectId}.appspot.com` : '',
        projectId ? `${projectId}.firebasestorage.app` : '',
      ].filter((v): v is string => Boolean(v)),
    ),
  ]
}

function safeStoragePath(path: string): string | null {
  const cleaned = String(path || '').replace(/^\/+/, '').trim()
  if (!cleaned || cleaned.includes('..')) return null
  return cleaned
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.webm')) return 'audio/webm'
  if (lower.endsWith('.aac')) return 'audio/aac'
  return 'audio/mp4'
}

export function recordingFileExtension(path: string, contentType?: string): string {
  const lower = `${path} ${contentType || ''}`.toLowerCase()
  if (lower.includes('.wav') || lower.includes('audio/wav')) return 'wav'
  if (lower.includes('.mp3') || lower.includes('mpeg')) return 'mp3'
  if (lower.includes('.ogg')) return 'ogg'
  if (lower.includes('.webm')) return 'webm'
  return 'm4a'
}

async function getStorageFile(storagePath: string) {
  const path = safeStoragePath(storagePath)
  if (!path) return null
  const app = getFirebaseAdmin()
  for (const bucketName of storageBucketNames()) {
    try {
      const file = admin.storage(app).bucket(bucketName).file(path)
      const [exists] = await file.exists()
      if (exists) return file
    } catch (err: any) {
      console.warn('deviceRecordings: storage lookup failed', bucketName, err?.message || err)
    }
  }
  return null
}

export async function downloadDeviceRecording(
  recording: DeviceCallRecording,
): Promise<{ body: Buffer; contentType: string; fileName: string }> {
  const file = await getStorageFile(recording.firebaseStoragePath)
  if (!file) {
    const err = new Error('Recording not available.') as Error & { status: number }
    err.status = 404
    throw err
  }
  const [body] = await file.download()
  const contentType = contentTypeForPath(recording.firebaseStoragePath)
  const ext = recordingFileExtension(recording.firebaseStoragePath, contentType)
  return {
    body: Buffer.from(body),
    contentType,
    fileName: `recording-${recording.callLogId || recording.id}.${ext}`,
  }
}

export async function getDeviceRecordingSignedUrl(
  recording: DeviceCallRecording,
  expiresMs = 15 * 60 * 1000,
): Promise<string | null> {
  const file = await getStorageFile(recording.firebaseStoragePath)
  if (!file) return null
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresMs,
  })
  return url || null
}
