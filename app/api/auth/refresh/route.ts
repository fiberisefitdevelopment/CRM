export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  rotateRefreshToken,
  findValidRefreshRecord,
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthFailures,
  getClientIp,
  getCachedActiveUser,
  type DeviceMeta,
} from '@/src/services/auth'
import { logAction } from '@/src/services/auditLogService'
import { roleSatisfiesRequired } from '@/src/utils/accessControl'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const refreshToken = body?.refreshToken ? String(body.refreshToken) : ''
    if (!refreshToken) {
      return NextResponse.json({ error: 'refreshToken is required.' }, { status: 400 })
    }

    const ip = getClientIp(req)
    const rate = checkAuthRateLimit(ip, 'refresh')
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: 'Too many refresh attempts. Please try again later.',
          retryAfterSec: rate.retryAfterSec,
        },
        { status: 429 },
      )
    }

    const existing = await findValidRefreshRecord(refreshToken)
    if (!existing) {
      recordAuthFailure(ip, 'refresh')
      return NextResponse.json({ error: 'Invalid or expired refresh token.' }, { status: 401 })
    }

    const user = await getCachedActiveUser(existing.userId)
    if (!user) {
      recordAuthFailure(ip, 'refresh')
      return NextResponse.json({ error: 'Invalid or expired refresh token.' }, { status: 401 })
    }

    const requiredRole = body.requiredRole ? String(body.requiredRole).toLowerCase().trim() : ''
    if (requiredRole && !roleSatisfiesRequired(user.role, requiredRole)) {
      return NextResponse.json(
        {
          error:
            requiredRole === 'care_executive'
              ? 'This app is only available to customer care executives.'
              : 'Your account does not have access to this app.',
          role: user.role,
        },
        { status: 403 },
      )
    }

    const device: DeviceMeta = {
      deviceId: body.deviceId ? String(body.deviceId) : existing.deviceId,
      deviceName: body.deviceName ? String(body.deviceName) : existing.deviceName,
      platform: body.platform ? String(body.platform) : existing.platform,
    }

    const tokens = await rotateRefreshToken(refreshToken, user, { req, device, existing })
    if (!tokens) {
      recordAuthFailure(ip, 'refresh')
      return NextResponse.json({ error: 'Invalid or expired refresh token.' }, { status: 401 })
    }

    clearAuthFailures(ip, 'refresh')

    logAction({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      actionType: 'TOKEN_REFRESH',
      description: `${user.email} refreshed access token`,
      module: 'auth',
      status: 'success',
      details: { deviceId: device.deviceId, platform: device.platform },
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
    console.error('Refresh error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to refresh token.' },
      { status: 500 },
    )
  }
}
