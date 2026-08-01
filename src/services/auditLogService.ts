import admin from 'firebase-admin';
import { getFirebaseAdmin } from '@/src/firebase/firebase.config';
import { NextRequest } from 'next/server';
import { parseUserAgent } from '@/src/utils/userAgentParser';

// ─── Enhanced Audit Log Entry ────────────────────────────────────────────────

export interface AuditLogEntry {
  id?: string
  // User identity
  userId: string
  userEmail: string
  userName: string
  userRole: string
  sessionId: string
  // Action details
  actionType: string
  description: string
  module: string    // 'auth' | 'orders' | 'whatsapp' | 'crm' | 'admin' | 'system'
  status: 'success' | 'failure'
  // Request metadata
  method: string
  path: string
  // Network & device
  ipAddress: string
  userAgent: string
  device: string
  os: string
  browser: string
  // Data changes (for updates)
  changes?: {
    before?: any
    after?: any
  }
  // Freeform payload
  details: any
  // Timestamp
  timestamp: admin.firestore.Timestamp | any
}

// ─── Firestore Access ────────────────────────────────────────────────────────

function getDb() {
  const app = getFirebaseAdmin();
  return admin.firestore(app);
}

function formatToIPv4(ip: string): string {
  if (!ip || ip === 'N/A') return 'N/A'
  let cleanIp = ip.trim()

  // Handle brackets (commonly surrounding IPv6 addresses in URLs, e.g. [::1]:3000)
  if (cleanIp.startsWith('[') && cleanIp.includes(']')) {
    const endBracket = cleanIp.indexOf(']')
    cleanIp = cleanIp.substring(1, endBracket)
  } else {
    // If it's IPv4 or standard IP, strip port if there is one colon
    const colonCount = (cleanIp.match(/:/g) || []).length
    if (colonCount === 1) {
      cleanIp = cleanIp.split(':')[0]
    }
  }

  // Handle loopbacks
  if (cleanIp === '::1' || cleanIp === '::') {
    return '127.0.0.1'
  }

  // Handle IPv6 mapped IPv4 format
  if (cleanIp.startsWith('::ffff:')) {
    return cleanIp.substring(7)
  }

  return cleanIp
}

function extractIpAddress(req?: NextRequest | Request): string {
  if (!req) return 'N/A'
  // Priority: x-real-ip > x-forwarded-for (first entry) > req.ip > fallback
  const xRealIp = req.headers.get('x-real-ip')
  if (xRealIp) return formatToIPv4(xRealIp)

  const xForwardedFor = req.headers.get('x-forwarded-for')
  if (xForwardedFor) return formatToIPv4(xForwardedFor.split(',')[0])

  return formatToIPv4((req as any).ip || 'N/A')
}

// ─── Main: Log Action ────────────────────────────────────────────────────────

export interface LogActionParams {
  userId: string
  userEmail: string
  userName?: string
  userRole?: string
  sessionId?: string
  actionType: string
  description: string
  module: string
  status: 'success' | 'failure'
  changes?: { before?: any; after?: any }
  details?: any
  req?: NextRequest | Request
}

/**
 * Log an auditable action to the Firestore `action_logs` collection.
 * This function is designed to be fire-and-forget — callers should NOT await it
 * unless they need the log ID. Errors are caught internally and never thrown.
 */
export async function logAction(params: LogActionParams): Promise<string | null> {
  try {
    const db = getDb();

    // Extract network metadata from request
    const ipAddress = extractIpAddress(params.req)
    const rawUserAgent = params.req?.headers.get('user-agent') || 'N/A'
    const parsedUA = parseUserAgent(rawUserAgent)

    // Extract request method & path
    let method = 'N/A'
    let path = 'N/A'
    if (params.req) {
      method = params.req.method || 'N/A'
      try {
        const url = new URL((params.req as NextRequest).url || '', 'http://localhost')
        path = url.pathname
      } catch {
        path = 'N/A'
      }
    }

    const logEntry: Omit<AuditLogEntry, 'id'> = {
      // User identity
      userId: params.userId || 'system',
      userEmail: params.userEmail || 'system@fiberisefit.com',
      userName: params.userName || params.userEmail?.split('@')[0] || 'system',
      userRole: params.userRole || 'unknown',
      sessionId: params.sessionId || '',
      // Action details
      actionType: params.actionType,
      description: params.description,
      module: params.module,
      status: params.status,
      // Request metadata
      method,
      path,
      // Network & device
      ipAddress,
      userAgent: rawUserAgent,
      device: parsedUA.device,
      os: parsedUA.os,
      browser: parsedUA.browser,
      // Data changes
      ...(params.changes ? { changes: params.changes } : {}),
      // Freeform payload
      details: params.details || {},
      // Timestamp
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }

    const docRef = await db.collection('action_logs').add(logEntry);
    console.log(`🔒 [Audit] ${params.status.toUpperCase()} | ${params.actionType} | ${params.userEmail} | ${ipAddress}`);
    return docRef.id;
  } catch (error) {
    console.error('⚠️ [Audit] Failed to write audit log:', error);
    return null;
  }
}

// ─── Query: Paginated + Filtered ─────────────────────────────────────────────

export interface AuditQueryParams {
  page: number
  perPage: number
  actionType?: string
  module?: string
  userEmail?: string
  status?: string
  search?: string
  startDate?: string
  endDate?: string
  ipAddress?: string
}

export async function getActionLogsPaginated(params: AuditQueryParams): Promise<{
  logs: (AuditLogEntry & { id: string })[]
  total: number
}> {
  try {
    const db = getDb();
    const collection = db.collection('action_logs')

    // Build the base query with ordering
    let query: admin.firestore.Query = collection.orderBy('timestamp', 'desc')

    // Apply Firestore-native filters (equality filters work well)
    if (params.module && params.module !== 'all') {
      query = query.where('module', '==', params.module)
    }
    if (params.status && params.status !== 'all') {
      query = query.where('status', '==', params.status)
    }
    if (params.userEmail && params.userEmail.trim()) {
      query = query.where('userEmail', '==', params.userEmail.trim().toLowerCase())
    }

    // For action type categories, map to Firestore-compatible filters
    if (params.actionType && params.actionType !== 'ALL' && params.actionType !== 'all') {
      const typeMap: Record<string, string[]> = {
        'AUTH': ['USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED'],
        'ORDERS': ['ORDER_CREATE', 'ORDER_CANCEL', 'ORDER_CLONE', 'BULK_ORDER_CANCEL'],
        'WHATSAPP': ['CREATE_TEMPLATE', 'UPDATE_TEMPLATE', 'DELETE_TEMPLATE', 'UPDATE_JOURNEY_STATUS'],
        'SYSTEM': ['TRIGGER_TEST_RTO_EMAIL', 'DATA_EXPORT', 'SYSTEM_ACTION'],
      }
      const mapped = typeMap[params.actionType.toUpperCase()]
      if (mapped) {
        query = query.where('actionType', 'in', mapped)
      } else {
        // Direct action type match
        query = query.where('actionType', '==', params.actionType)
      }
    }

    // Date range filtering
    if (params.startDate) {
      const startTs = admin.firestore.Timestamp.fromDate(new Date(params.startDate))
      query = query.where('timestamp', '>=', startTs)
    }
    if (params.endDate) {
      const endDate = new Date(params.endDate)
      endDate.setHours(23, 59, 59, 999)
      const endTs = admin.firestore.Timestamp.fromDate(endDate)
      query = query.where('timestamp', '<=', endTs)
    }

    // Fetch all matching docs for total count (Firestore limitation — no COUNT(*))
    // For large datasets, we'd use a counter doc; for now this is fine for <10k logs
    const countSnap = await query.get()
    let allDocs = countSnap.docs

    // Apply post-fetch filters that Firestore can't handle natively
    if (params.ipAddress && params.ipAddress.trim()) {
      const ipSearch = params.ipAddress.trim().toLowerCase()
      allDocs = allDocs.filter(doc => {
        const data = doc.data()
        const formattedIp = formatToIPv4(data.ipAddress || 'N/A')
        return formattedIp.toLowerCase().includes(ipSearch)
      })
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase()
      allDocs = allDocs.filter(doc => {
        const d = doc.data()
        const formattedIp = formatToIPv4(d.ipAddress || 'N/A')
        return (
          (d.userEmail || '').toLowerCase().includes(q) ||
          (d.actionType || '').toLowerCase().includes(q) ||
          (d.description || '').toLowerCase().includes(q) ||
          formattedIp.toLowerCase().includes(q) ||
          (d.module || '').toLowerCase().includes(q) ||
          (d.userName || '').toLowerCase().includes(q)
        )
      })
    }

    const total = allDocs.length
    const start = (params.page - 1) * params.perPage
    const paginatedDocs = allDocs.slice(start, start + params.perPage)

    const logs = paginatedDocs.map(doc => {
      const data = doc.data()
      // Normalize timestamp to ISO string
      let isoTimestamp = new Date().toISOString()
      if (data.timestamp) {
        if (typeof data.timestamp.toDate === 'function') {
          isoTimestamp = data.timestamp.toDate().toISOString()
        } else if (data.timestamp._seconds) {
          isoTimestamp = new Date(data.timestamp._seconds * 1000).toISOString()
        } else if (typeof data.timestamp === 'string') {
          isoTimestamp = data.timestamp
        }
      }

      return {
        id: doc.id,
        userId: data.userId || '',
        userEmail: data.userEmail || '',
        userName: data.userName || data.userEmail?.split('@')[0] || '',
        userRole: data.userRole || data.details?.role || 'unknown',
        sessionId: data.sessionId || '',
        actionType: data.actionType || '',
        description: data.description || '',
        module: data.module || 'system',
        status: data.status || 'success',
        method: data.method || 'N/A',
        path: data.path || 'N/A',
        ipAddress: formatToIPv4(data.ipAddress || 'N/A'),
        userAgent: data.userAgent || 'N/A',
        device: data.device || 'Unknown',
        os: data.os || 'Unknown',
        browser: data.browser || 'Unknown',
        changes: data.changes || undefined,
        details: data.details || {},
        timestamp: isoTimestamp,
      } as AuditLogEntry & { id: string }
    })

    return { logs, total }
  } catch (error) {
    console.error('⚠️ [Audit] Failed to query paginated logs:', error);
    return { logs: [], total: 0 }
  }
}

// ─── Legacy Compatibility ────────────────────────────────────────────────────
// Keep the old getActionLogs function for backward compatibility

export async function getActionLogs(limitCount = 100): Promise<(AuditLogEntry & { id: string })[]> {
  const result = await getActionLogsPaginated({ page: 1, perPage: limitCount })
  return result.logs
}
