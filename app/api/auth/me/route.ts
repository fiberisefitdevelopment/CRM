export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromRequest, authErrorResponse } from '@/src/services/auth'

function formatToIPv4(ip: string): string {
  if (!ip || ip === 'N/A') return '127.0.0.1'
  let cleanIp = ip.trim()

  if (cleanIp.startsWith('[') && cleanIp.includes(']')) {
    const endBracket = cleanIp.indexOf(']')
    cleanIp = cleanIp.substring(1, endBracket)
  } else {
    const colonCount = (cleanIp.match(/:/g) || []).length
    if (colonCount === 1) {
      cleanIp = cleanIp.split(':')[0]
    }
  }

  if (cleanIp === '::1' || cleanIp === '::') {
    return '127.0.0.1'
  }

  if (cleanIp.startsWith('::ffff:')) {
    return cleanIp.substring(7)
  }

  return cleanIp
}

export async function GET(req: NextRequest) {
  try {
    // JWT already carries id/name/email/role — skip Firestore so bootstrap is instant.
    const user = await getAuthFromRequest(req)
    if (!user?.id) {
      return NextResponse.json(
        { authenticated: false, error: 'No active session found.' },
        { status: 401 },
      )
    }

    let ipAddress = '127.0.0.1'
    const xForwardedFor = req.headers.get('x-forwarded-for')
    if (xForwardedFor) {
      ipAddress = xForwardedFor.split(',')[0].trim()
    } else {
      ipAddress = (req as any).ip || '127.0.0.1'
    }
    ipAddress = formatToIPv4(ipAddress)

    return NextResponse.json(
      {
        authenticated: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          ipAddress,
        },
      },
      { status: 200 },
    )
  } catch (error: any) {
    if (error?.status === 401) {
      return NextResponse.json(
        { authenticated: false, error: 'No active session found.' },
        { status: 401 },
      )
    }
    return authErrorResponse(error)
  }
}
