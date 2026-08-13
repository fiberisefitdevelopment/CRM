import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

function getAccessSecret(): Uint8Array {
  const secret =
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== 'production'
      ? 'dev-jwt_access_secret-fiberise-fallback'
      : '')
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is required in production')
  }
  return new TextEncoder().encode(secret)
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null
}

async function isValidAccessToken(token: string): Promise<boolean> {
  if (!token || (token.includes(':') && !token.startsWith('eyJ'))) return false
  try {
    const { payload } = await jwtVerify(token, getAccessSecret(), {
      algorithms: ['HS256'],
    })
    const id = String(payload.sub || '')
    const email = String(payload.email || '')
    const role = String(payload.role || '')
    if (!id || !email || !role) return false
    const expiresAt =
      typeof payload.expiresAt === 'number'
        ? payload.expiresAt
        : typeof payload.exp === 'number'
          ? payload.exp * 1000
          : 0
    return Boolean(expiresAt && Date.now() <= expiresAt)
  } catch {
    return false
  }
}

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/webhooks/',
  '/api/cron/',
]

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  )
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // Page routes: client AuthProvider handles redirects (no auth cookies)
  if (!pathname.startsWith('/api/')) {
    const res = NextResponse.next()
    if (pathname === '/login') {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
      res.headers.set('Pragma', 'no-cache')
    } else if (!pathname.includes('/recording')) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      res.headers.set('Pragma', 'no-cache')
    }
    return res
  }

  if (isPublicApi(pathname)) {
    return NextResponse.next()
  }

  // Logout / me / register require a valid access token (or handle auth themselves)
  const token = extractBearer(req)
  const valid = token ? await isValidAccessToken(token) : false

  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/orders/:path*',
    '/order-status/:path*',
    '/confirmed-orders/:path*',
    '/whatsapp/:path*',
    '/shiprocket/:path*',
    '/sales-dashboard/:path*',
    '/audit-logs/:path*',
    '/notifications/:path*',
    '/tickets/:path*',
    '/customer-service/:path*',
    '/air-express/:path*',
    '/meta-analytics/:path*',
    '/products/:path*',
    '/user/:path*',
    '/crm/:path*',
    '/login',
    '/api/:path*',
  ],
}
