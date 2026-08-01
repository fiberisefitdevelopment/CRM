import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import type { CareAssignee } from './types'

export interface AssignmentStrategy {
  name: string
  pickNext(executives: CareAssignee[]): Promise<CareAssignee | null>
}

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

/** Active care executives eligible for assignment. */
export async function listActiveCareExecutives(): Promise<CareAssignee[]> {
  const db = getDb()
  const results: CareAssignee[] = []

  // Prefer explicit careExecutive flag
  const flagged = await db.collection('users').where('careExecutive', '==', true).get()
  for (const doc of flagged.docs) {
    const d = doc.data()
    if (d.active === false) continue
    results.push({
      userId: doc.id,
      email: String(d.email || '').toLowerCase(),
      name: String(d.name || d.email?.split('@')[0] || 'Executive'),
    })
  }

  // Fallback: role care_executive / support
  if (results.length === 0) {
    for (const role of ['care_executive', 'support']) {
      const q = await db.collection('users').where('role', '==', role).get()
      for (const doc of q.docs) {
        const d = doc.data()
        if (d.active === false) continue
        const email = String(d.email || '').toLowerCase()
        if (results.some((r) => r.email === email)) continue
        results.push({
          userId: doc.id,
          email,
          name: String(d.name || d.email?.split('@')[0] || 'Executive'),
        })
      }
    }
  }

  return results.filter((e) => e.email)
}

export class RoundRobinStrategy implements AssignmentStrategy {
  name = 'round_robin'

  async pickNext(executives: CareAssignee[]): Promise<CareAssignee | null> {
    const active = executives.filter((e) => e.email)
    if (active.length === 0) return null
    if (active.length === 1) return active[0]

    const ref = getDb().collection('careAssignmentState').doc('round_robin')
    return getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const lastIndex = snap.exists ? Number(snap.data()?.lastIndex ?? -1) : -1
      const nextIndex = (lastIndex + 1) % active.length
      tx.set(
        ref,
        {
          lastIndex: nextIndex,
          lastEmail: active[nextIndex].email,
          strategy: this.name,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return active[nextIndex]
    })
  }
}

/** Extensible entry point — swap strategy later without changing callers. */
let activeStrategy: AssignmentStrategy = new RoundRobinStrategy()

export function setAssignmentStrategy(strategy: AssignmentStrategy) {
  activeStrategy = strategy
}

/** Fallback when Firestore has no flagged executive yet. */
export const DEFAULT_CARE_EXECUTIVE: CareAssignee = {
  userId: 'support-fiberisefit',
  email: 'support@fiberisefit.com',
  name: 'Customer Care Executive',
}

export async function assignCareExecutive(): Promise<CareAssignee | null> {
  const executives = await listActiveCareExecutives()
  if (executives.length === 0) {
    console.warn('careTasks: no active care executives for assignment — using default support@')
    return DEFAULT_CARE_EXECUTIVE
  }
  return activeStrategy.pickNext(executives)
}
