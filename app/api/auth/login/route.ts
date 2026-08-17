export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import {
  verifyPassword,
  seedAdminUser,
  issueTokenPair,
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthFailures,
  getClientIp,
  type AuthUser,
  type DeviceMeta,
} from '@/src/services/auth'
import { logAction } from '@/src/services/auditLogService'

export async function POST(req: NextRequest) {
  try {
    // Seed default accounts off the login critical path (first boot only).
    void seedAdminUser()

    const body = await req.json().catch(() => null)
    if (!body?.email || !body?.password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      )
    }

    const email = String(body.email).toLowerCase().trim()
    const password = String(body.password)
    const ip = getClientIp(req)

    const rate = checkAuthRateLimit(ip, email)
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: 'Too many login attempts. Please try again later.',
          retryAfterSec: rate.retryAfterSec,
        },
        { status: 429 },
      )
    }

    const app = getFirebaseAdmin()
    const db = admin.firestore(app)
    const query = await db.collection('users').where('email', '==', email).limit(1).get()

    if (query.empty) {
      recordAuthFailure(ip, email)
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

    if (userData.active === false) {
      recordAuthFailure(ip, email)
      logAction({
        userId: userDoc.id,
        userEmail: email,
        userName: userData.name || email.split('@')[0] || '',
        userRole: userData.role || 'user',
        actionType: 'LOGIN_FAILED',
        description: `Failed login attempt for inactive user ${email}`,
        module: 'auth',
        status: 'failure',
        details: { reason: 'Account inactive' },
        req,
      })
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      )
    }

    if (!verifyPassword(password, userData.salt, userData.passwordHash)) {
      recordAuthFailure(ip, email)
      logAction({
        userId: userDoc.id,
        userEmail: email,
        userName: userData.name || email.split('@')[0] || '',
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

    clearAuthFailures(ip, email)

    void userDoc.ref.update({
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const user: AuthUser = {
      id: userDoc.id,
      email: userData.email,
      name: userData.name || userData.email?.split('@')[0] || '',
      role: userData.role || 'user',
    }

    const device: DeviceMeta = {
      deviceId: body.deviceId ? String(body.deviceId) : undefined,
      deviceName: body.deviceName ? String(body.deviceName) : undefined,
      platform: body.platform ? String(body.platform) : 'web',
    }

    const tokens = await issueTokenPair(user, { req, device })

    logAction({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      actionType: 'USER_LOGIN',
      description: `${user.email} logged in successfully`,
      module: 'auth',
      status: 'success',
      details: {
        role: user.role,
        deviceId: device.deviceId,
        platform: device.platform || 'web',
      },
      req,
    })

    return NextResponse.json(
      {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to authenticate user.' },
      { status: 500 },
    )
  }
}
