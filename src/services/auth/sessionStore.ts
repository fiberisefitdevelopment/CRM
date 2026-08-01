import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import type { AuthUser } from './types'

/** Ensure JWT sessionId still matches Firestore (single active login). */
export async function validateSession(user: AuthUser): Promise<boolean> {
  try {
    if (!user?.email || !user.sessionId) return false

    const db = admin.firestore(getFirebaseAdmin())
    const query = await db
      .collection('users')
      .where('email', '==', user.email.toLowerCase().trim())
      .limit(1)
      .get()

    if (query.empty) return false
    return query.docs[0].data().activeSessionId === user.sessionId
  } catch (error) {
    console.error('Session validation error:', error)
    return false
  }
}
