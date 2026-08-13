/**
 * Deactivate support@fiberisefit.com and move their open care tasks
 * onto the active executive pool (Shubham / Kawalnain).
 *
 * Usage: npx tsx scripts/deactivate-support-care-executive.ts
 */
import 'dotenv/config'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '../src/firebase/firebase.config'
import {
  clearCareExecutivePoolCache,
  redistributeOpenTasksAmongExecutives,
} from '../src/services/careTasks/assignmentEngine'
import { invalidateCareTasksCache } from '../src/services/careTasks/taskCache'

async function main() {
  getFirebaseAdmin()
  const db = admin.firestore()
  const email = 'support@fiberisefit.com'

  const users = await db.collection('users').where('email', '==', email).get()
  if (users.empty) {
    console.log(`No user doc found for ${email}`)
  } else {
    for (const doc of users.docs) {
      await doc.ref.update({
        active: false,
        careExecutive: false,
        updatedAt: new Date().toISOString(),
      })
      console.log(`Deactivated user ${doc.id} (${email})`)
    }
  }

  clearCareExecutivePoolCache()
  const moved = await redistributeOpenTasksAmongExecutives()
  invalidateCareTasksCache()
  console.log(`Redistributed ${moved} open task assignment(s) across active executives`)
  console.log('Done. support@ can no longer log in or receive new care tasks.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
