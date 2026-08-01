export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import {
  hashPassword,
  requireRole,
  authErrorResponse,
} from '@/src/services/auth'

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, 'admin', 'super_admin')

    const body = await req.json().catch(() => null)
    if (!body?.email || !body?.password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      )
    }

    const email = String(body.email).toLowerCase().trim()
    const password = String(body.password)
    const role = String(body.role || 'employee').toLowerCase().trim()
    const name = body.name ? String(body.name).trim() : email.split('@')[0]

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 },
      )
    }

    const app = getFirebaseAdmin()
    const db = admin.firestore(app)
    const usersCol = db.collection('users')

    if (role === 'super_admin') {
      const superAdminQuery = await usersCol.where('role', '==', 'super_admin').limit(1).get()
      if (!superAdminQuery.empty) {
        return NextResponse.json(
          {
            error:
              'A Super Admin account already exists in the system. Only one Super Admin is allowed.',
          },
          { status: 409 },
        )
      }
    }

    const query = await usersCol.where('email', '==', email).limit(1).get()
    if (!query.empty) {
      return NextResponse.json(
        { error: 'User with this email already exists.' },
        { status: 409 },
      )
    }

    const salt = crypto.randomBytes(16).toString('hex')
    const passwordHash = hashPassword(password, salt)

    const docRef = await usersCol.add({
      email,
      name,
      salt,
      passwordHash,
      role,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return NextResponse.json(
      {
        success: true,
        message: `User ${email} registered successfully with role '${role}'.`,
        userId: docRef.id,
      },
      { status: 201 },
    )
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return authErrorResponse(error)
    }
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to register user.' },
      { status: 500 },
    )
  }
}
