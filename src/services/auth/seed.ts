import crypto from 'crypto'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { hashPassword } from './passwords'
import { careExecutiveDisplayName } from '@/src/services/careTasks/executiveConfig'
import { migrateLegacyCareExecutiveEmails } from '@/src/services/careTasks/assignmentEngine'

let isSeeded = false

function careExecutiveName(email: string): string {
  return careExecutiveDisplayName(email)
}

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
        extras.name = careExecutiveName(normalized)
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
          const nextName = careExecutiveName(normalized)
          if (current.name !== nextName) patch.name = nextName
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
    // support@ is deactivated — keep the user doc but force inactive / out of care pool
    {
      const supportEmail = 'support@fiberisefit.com'
      const supportSnap = await usersCol.where('email', '==', supportEmail).limit(1).get()
      if (!supportSnap.empty) {
        const doc = supportSnap.docs[0]
        const d = doc.data() || {}
        const patch: Record<string, unknown> = {}
        if (d.active !== false) patch.active = false
        if (d.careExecutive !== false) patch.careExecutive = false
        if (Object.keys(patch).length) {
          await doc.ref.update(patch)
          console.log(`🚫 Deactivated care executive ${supportEmail}`)
        }
      }
    }
    await seedUserIfMissing('shubham.kumar@fiberisefit.com', '12345', 'care_executive', {
      syncRole: true,
      careExecutive: true,
    })
    await seedUserIfMissing('kawalnain.singh@fiberisefit.com', '12345', 'care_executive', {
      syncRole: true,
      careExecutive: true,
    })

    const migrated = await migrateLegacyCareExecutiveEmails()
    if (migrated > 0) {
      console.log(`🔄 Migrated ${migrated} care records to new executive emails`)
    }

    isSeeded = true
  } catch (error) {
    console.error('❌ Failed to seed default users:', error)
  }
}
