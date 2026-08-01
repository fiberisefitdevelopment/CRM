export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  revokeRefreshToken,
  revokeAllRefreshTokens,
  optionalAuth,
  findValidRefreshRecord,
} from '@/src/services/auth'
import { logAction } from '@/src/services/auditLogService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const refreshToken = body?.refreshToken ? String(body.refreshToken) : ''
    const allDevices = Boolean(body?.allDevices)

    const session = await optionalAuth(req)
    let userId = session?.id
    let userEmail = session?.email || ''
    let userName = session?.name || ''
    let userRole = session?.role || 'user'

    if (allDevices) {
      if (!userId && refreshToken) {
        const record = await findValidRefreshRecord(refreshToken)
        if (record) userId = record.userId
      }
      if (!userId) {
        return NextResponse.json(
          { error: 'Authentication required to logout from all devices.' },
          { status: 401 },
        )
      }

      const count = await revokeAllRefreshTokens(userId)
      logAction({
        userId,
        userEmail,
        userName,
        userRole,
        actionType: 'LOGOUT_ALL_DEVICES',
        description: `${userEmail || userId} logged out from all devices (${count} sessions)`,
        module: 'auth',
        status: 'success',
        details: { revokedCount: count },
        req,
      })
      return NextResponse.json({ success: true, revokedCount: count }, { status: 200 })
    }

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'refreshToken is required unless allDevices is true.' },
        { status: 400 },
      )
    }

    const result = await revokeRefreshToken(refreshToken)
    if (result.userId) userId = result.userId

    logAction({
      userId: userId || 'unknown',
      userEmail,
      userName,
      userRole,
      actionType: 'USER_LOGOUT',
      description: `${userEmail || 'user'} logged out`,
      module: 'auth',
      status: 'success',
      details: { tokenId: result.tokenId, revoked: result.revoked },
      req,
    })

    if (result.revoked) {
      logAction({
        userId: userId || 'unknown',
        userEmail,
        userName,
        userRole,
        actionType: 'TOKEN_REVOKED',
        description: `Refresh token revoked for ${userEmail || userId}`,
        module: 'auth',
        status: 'success',
        details: { tokenId: result.tokenId },
        req,
      })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to logout.' },
      { status: 500 },
    )
  }
}
