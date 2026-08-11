import crypto from 'crypto'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { hashPassword } from './passwords'

let isSeeded = false

/** Ensure default role accounts exist in Firestore. */
export async function seedAdminUser(): Promise<void> {
  if (isSeeded) return
  try {
    const db = admin.firestore(getFirebaseAdmin())
    const usersCol = db.collection('users')

    const seedUserIfMissing = async (
      email: string,
      password: string,
      role: string,
      opts?: { syncRole?: boolean; careExecutive?: boolean },
    ) => {
      const normalized = email.toLowerCase().trim()
      const query = await usersCol.where('email', '==', normalized).limit(1).get()
      const extras: Record<string, unknown> = {}
      if (opts?.careExecutive) {
        extras.careExecutive = true
        extras.active = true
        if (normalized.includes('executive1')) extras.name = 'Executive 1'
        else if (normalized.includes('executive2')) extras.name = 'Executive 2'
        else extras.name = 'Customer Care Executive'
      }
      if (query.empty) {
        console.log(`🌱 Seeding default ${role} user: ${email}`)
        const salt = crypto.randomBytes(16).toString('hex')
        const passwordHash = hashPassword(password, salt)

        await usersCol.add({
          email: normalized,
          salt,
          passwordHash,
          role,
          active: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...extras,
        })
        console.log(`✅ Default ${role} user seeded successfully`)
      } else if (opts?.syncRole) {
        const current = query.docs[0].data()
        const patch: Record<string, unknown> = {}
        if (current.role !== role) patch.role = role
        if (opts.careExecutive) {
          if (current.careExecutive !== true) patch.careExecutive = true
          if (current.active === false || current.active == null) patch.active = true
          if (normalized.includes('executive1')) patch.name = 'Executive 1'
          else if (normalized.includes('executive2')) patch.name = 'Executive 2'
          else if (!current.name || current.name === 'Customer Care Executive') {
            patch.name = 'Customer Care Executive'
          }
        }
        if (Object.keys(patch).length > 0) {
          await query.docs[0].ref.update(patch)
          console.log(`🔄 Updated user ${email}`, patch)
        }
      }
    }

    await seedUserIfMissing('superadmin@fiberisefit.com', 'superadmin@1234', 'super_admin')
    await seedUserIfMissing('admin@fiberisefit.com', 'admin@1234', 'admin')
    await seedUserIfMissing('employee@fiberisefit.com', 'employee@1234', 'employee')
    await seedUserIfMissing('ceo@fiberisefit.com', '12345', 'admin')
    await seedUserIfMissing('priyanshu@fiberisefit.com', '12345', 'admin')
    await seedUserIfMissing('support@fiberisefit.com', '12345', 'care_executive', {
      syncRole: true,
      careExecutive: true,
    })
    await seedUserIfMissing('executive1@fiberisefit.com', '12345', 'care_executive', {
      syncRole: true,
      careExecutive: true,
    })
    await seedUserIfMissing('executive2@fiberisefit.com', '12345', 'care_executive', {
      syncRole: true,
      careExecutive: true,
    })

    isSeeded = true
  } catch (error) {
    console.error('❌ Failed to seed default users:', error)
  }
}
