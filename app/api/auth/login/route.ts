export const dynamic = 'force-dynamic'

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import { hashPassword, encryptSession, seedAdminUser } from '@/src/services/auth'
import { logAction } from '@/src/services/auditLogService'

export async function POST(req: NextRequest) {
  try {
    // 1. Ensure the default admin user is seeded
    await seedAdminUser()

    const body = await req.json().catch(() => null)
    if (!body?.email || !body?.password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      )
    }

    const email = String(body.email).toLowerCase().trim()
    const password = String(body.password)

    // 2. Fetch the user doc from Firestore
    const app = getFirebaseAdmin()
    const db = admin.firestore(app)
    const query = await db.collection('users').where('email', '==', email).limit(1).get()

    if (query.empty) {
      // Log failed login — unknown email
      logAction({
        userId: 'unknown',
        userEmail: email,
        actionType: 'LOGIN_FAILED',
        description: `Failed login attempt for unknown email: ${email}`,
        module: 'auth',
        status: 'failure',
        details: { reason: 'Email not found' },
        req,
      })
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      )
    }

    const userDoc = query.docs[0]
    const userData = userDoc.data()

    // 3. Hash input password with saved salt and verify
    const computedHash = hashPassword(password, userData.salt)
    if (computedHash !== userData.passwordHash) {
      // Log failed login — wrong password
      logAction({
        userId: userDoc.id,
        userEmail: email,
        userName: userData.email?.split('@')[0] || '',
        userRole: userData.role || 'user',
        actionType: 'LOGIN_FAILED',
        description: `Failed login attempt for ${email} — incorrect password`,
        module: 'auth',
        status: 'failure',
        details: { reason: 'Invalid password' },
        req,
      })
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      )
    }

    // Generate a unique session identifier to prevent concurrent logins
    const sessionId = crypto.randomUUID()

    // Update activeSessionId on user document
    await userDoc.ref.update({
      activeSessionId: sessionId,
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
    })

    // 4. Session payload
    const rememberMe = !!body?.rememberMe
    const duration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    const expiresAt = Date.now() + duration
    const tokenPayload = {
      email: userData.email,
      role: userData.role || 'user',
      sessionId,
      expiresAt,
    }

    // JWT session token (same cookie name / login response as before)
    const sessionToken = encryptSession(tokenPayload)

    // 5. Build response and assign HTTP-only cookie
    const res = NextResponse.json(
      {
        success: true,
        user: { email: userData.email, role: userData.role },
      },
      { status: 200 },
    )

    const protocol = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol
    const isHttps = protocol.includes('https')

    res.cookies.set('fiberise_session', sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(duration / 1000),
    })

    // Log successful login (fire-and-forget)
    logAction({
      userId: userDoc.id,
      userEmail: userData.email,
      userName: userData.email?.split('@')[0] || '',
      userRole: userData.role || 'user',
      sessionId,
      actionType: 'USER_LOGIN',
      description: `${userData.email} logged in successfully`,
      module: 'auth',
      status: 'success',
      details: { role: userData.role || 'user' },
      req,
    })

    return res
  } catch (error: any) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to authenticate user.' },
      { status: 500 },
    )
  }
}
