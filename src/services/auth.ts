import crypto from 'crypto'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

// Hash the environment variable to guarantee exactly 32 bytes for AES-256 key
const SECRET = crypto
  .createHash('sha256')
  .update(process.env.SESSION_SECRET || 'fiberise-dashboard-default-super-secret-key-32-chars')
  .digest()

export interface SessionData {
  email: string
  role: string
  sessionId?: string
  expiresAt: number
}

/**
 * Hash a password using PBKDF2 with SHA-512
 */
export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')
}

/**
 * Encrypt session data into a stateless token
 */
export function encryptSession(data: SessionData): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET, iv)
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

/**
 * Decrypt session token and validate structure & expiry
 */
export function decryptSession(token: string): SessionData | null {
  try {
    const parts = token.split(':')
    if (parts.length !== 2) return null
    const iv = Buffer.from(parts[0], 'hex')
    const encryptedText = Buffer.from(parts[1], 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET, iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    
    const session = JSON.parse(decrypted.toString()) as SessionData
    if (Date.now() > session.expiresAt) {
      return null // Expired
    }
    return session
  } catch (err) {
    return null
  }
}

/**
 * Helper to validate session cookie dynamically against Firestore activeSessionId
 */
export async function validateSession(session: SessionData): Promise<boolean> {
  try {
    if (!session || !session.email || !session.sessionId) return false

    const app = getFirebaseAdmin()
    const db = admin.firestore(app)
    const query = await db.collection('users')
      .where('email', '==', session.email.toLowerCase().trim())
      .limit(1)
      .get()

    if (query.empty) return false

    const userData = query.docs[0].data()
    return userData.activeSessionId === session.sessionId
  } catch (error) {
    console.error('Session validation error:', error)
    return false
  }
}

let isSeeded = false

/**
 * Self-seeding helper to ensure all role levels exist in Firestore
 */
export async function seedAdminUser(): Promise<void> {
  if (isSeeded) return
  try {
    const app = getFirebaseAdmin()
    const db = admin.firestore(app)
    const usersCol = db.collection('users')

    // Helper to seed a single user safely
    const seedUserIfMissing = async (email: string, password: string, role: string) => {
      const query = await usersCol.where('email', '==', email.toLowerCase().trim()).limit(1).get()
      if (query.empty) {
        console.log(`🌱 Seeding default ${role} user: ${email}`)
        const salt = crypto.randomBytes(16).toString('hex')
        const passwordHash = hashPassword(password, salt)
        
        await usersCol.add({
          email: email.toLowerCase().trim(),
          salt,
          passwordHash,
          role,
          activeSessionId: '', // initial blank session ID
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        })
        console.log(`✅ Default ${role} user seeded successfully`)
      }
    }

    // Seed Super Admin
    await seedUserIfMissing('superadmin@fiberisefit.com', 'superadmin@1234', 'super_admin')

    // Seed Standard Admin
    await seedUserIfMissing('admin@fiberisefit.com', 'admin@1234', 'admin')

    // Seed Employee
    await seedUserIfMissing('employee@fiberisefit.com', 'employee@1234', 'employee')

    // Seed CEO
    await seedUserIfMissing('ceo@fiberisefit.com', '12345', 'admin')

    // Seed Priyanshu
    await seedUserIfMissing('priyanshu@fiberisefit.com', '12345', 'admin')

    isSeeded = true
  } catch (error) {
    console.error('❌ Failed to seed default users:', error)
  }
}
