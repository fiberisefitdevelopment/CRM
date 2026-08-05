import fs from 'fs'
import path from 'path'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

const COLLECTION = 'rto_notified_orders'
const LEGACY_LOG_FILE_PATH = path.join(process.cwd(), 'src/services/rto_notified_orders.json')
const MIGRATED_MARKER_PATH = path.join(process.cwd(), 'src/services/.rto_notified_orders.migrated')

let legacyMigrationPromise: Promise<void> | null = null

function getDb() {
  const app = getFirebaseAdmin()
  return admin.firestore(app)
}

function readLegacyNotifiedIds(): string[] {
  try {
    if (!fs.existsSync(LEGACY_LOG_FILE_PATH)) return []
    const data = fs.readFileSync(LEGACY_LOG_FILE_PATH, 'utf-8')
    const list = JSON.parse(data)
    return Array.isArray(list) ? list.map(String) : []
  } catch (error) {
    console.error('⚠️ Failed to read legacy RTO notified orders registry:', error)
    return []
  }
}

function writeLegacyNotifiedIds(ids: string[]): void {
  try {
    const dir = path.dirname(LEGACY_LOG_FILE_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(LEGACY_LOG_FILE_PATH, JSON.stringify(ids, null, 2), 'utf-8')
  } catch (error) {
    console.error('⚠️ Failed to update legacy RTO notified orders registry:', error)
  }
}

function isLegacyMigrationDone(): boolean {
  try {
    if (fs.existsSync(MIGRATED_MARKER_PATH)) return true
    const ids = readLegacyNotifiedIds()
    return ids.length === 0
  } catch {
    return false
  }
}

function markLegacyMigrationDone(): void {
  try {
    fs.writeFileSync(
      MIGRATED_MARKER_PATH,
      JSON.stringify({ migratedAt: new Date().toISOString() }),
      'utf-8',
    )
  } catch (error) {
    console.error('⚠️ Failed to write RTO migration marker:', error)
  }
}

async function migrateLegacyRegistryToFirestore(): Promise<void> {
  if (isLegacyMigrationDone()) return

  const legacyIds = readLegacyNotifiedIds()
  if (legacyIds.length === 0) {
    markLegacyMigrationDone()
    return
  }

  const db = getDb()
  // Keep batches small — large commits time out when Firestore is under load
  const batchSize = 50

  for (let i = 0; i < legacyIds.length; i += batchSize) {
    const chunk = legacyIds.slice(i, i + batchSize)
    const batch = db.batch()

    for (const orderId of chunk) {
      const ref = db.collection(COLLECTION).doc(orderId)
      batch.set(
        ref,
        {
          orderId,
          source: 'legacy_json_migration',
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }

    await batch.commit()
  }

  markLegacyMigrationDone()
  console.log(`✅ Migrated ${legacyIds.length} legacy RTO notification records to Firestore`)
}

/** Fire-and-forget single-flight migration — never blocks RTO claims. */
function kickLegacyMigration(): void {
  if (isLegacyMigrationDone()) return
  if (legacyMigrationPromise) return

  legacyMigrationPromise = migrateLegacyRegistryToFirestore()
    .catch((error) => {
      console.error('⚠️ Failed to migrate legacy RTO notification registry:', error)
      // Allow a later retry after transient DEADLINE_EXCEEDED
      legacyMigrationPromise = null
    })
    .then(() => {
      // Keep promise settled on success so we don't re-enter
      if (isLegacyMigrationDone()) return
      legacyMigrationPromise = null
    })
}

function isAlreadyExistsError(error: unknown): boolean {
  const err = error as { code?: number | string; message?: string }
  return (
    err?.code === 6 ||
    err?.code === 'already-exists' ||
    err?.code === 'ALREADY_EXISTS' ||
    Boolean(err?.message?.includes('ALREADY_EXISTS'))
  )
}

function isDeadlineExceeded(error: unknown): boolean {
  const err = error as { code?: number | string; message?: string }
  return (
    err?.code === 4 ||
    err?.code === 'deadline-exceeded' ||
    err?.code === 'DEADLINE_EXCEEDED' ||
    Boolean(err?.message?.includes('DEADLINE_EXCEEDED'))
  )
}

async function claimInFirestore(orderId: string, orderName: string): Promise<boolean> {
  // Migration must not gate claims — it was causing 60s timeouts on every RTO alert
  kickLegacyMigration()

  const db = getDb()
  const ref = db.collection(COLLECTION).doc(orderId)

  try {
    await ref.create({
      orderId,
      orderName,
      source: 'rto_email_alert',
      notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return true
  } catch (error) {
    if (isAlreadyExistsError(error)) return false
    throw error
  }
}

async function releaseFirestoreClaim(orderId: string): Promise<void> {
  try {
    const db = getDb()
    await db.collection(COLLECTION).doc(orderId).delete()
  } catch (error) {
    console.error(`⚠️ Failed to release RTO notification claim for order ${orderId}:`, error)
  }
}

function claimInLegacyFile(orderId: string): boolean {
  const legacyIds = readLegacyNotifiedIds()
  if (legacyIds.includes(orderId)) return false
  writeLegacyNotifiedIds([...legacyIds, orderId])
  return true
}

function releaseLegacyClaim(orderId: string): void {
  const legacyIds = readLegacyNotifiedIds().filter((id) => id !== orderId)
  writeLegacyNotifiedIds(legacyIds)
}

/**
 * Atomically claim an order so only one RTO email is ever sent per order.
 * Uses Firestore in production and falls back to the local JSON registry if needed.
 */
export async function claimRtoNotification(orderId: string, orderName: string): Promise<boolean> {
  const normalizedId = String(orderId)

  try {
    return await claimInFirestore(normalizedId, orderName)
  } catch (error) {
    if (isDeadlineExceeded(error)) {
      console.warn(
        `⚠️ Firestore RTO claim timed out for ${orderName || normalizedId}, using legacy file fallback`,
      )
    } else {
      console.warn('⚠️ Firestore RTO registry unavailable, using legacy file fallback:', error)
    }
    return claimInLegacyFile(normalizedId)
  }
}

/**
 * Release a claim when email delivery fails so the order can be retried later.
 */
export async function releaseRtoNotificationClaim(orderId: string): Promise<void> {
  const normalizedId = String(orderId)

  try {
    await releaseFirestoreClaim(normalizedId)
  } catch {
    releaseLegacyClaim(normalizedId)
  }
}
