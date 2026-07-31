import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Skip checks for public assets, auth APIs, webhooks, and cron jobs
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const sessionCookie = req.cookies.get('fiberise_session')?.value

  // 2. If visiting /login while already authenticated → redirect to dashboard
  if (pathname === '/login') {
    if (sessionCookie) {
      try {
        const parts = sessionCookie.split(':')
        if (parts.length === 2 && parts[0].length === 32) {
          // Valid session structure — redirect authenticated user away from login
          const dashboardUrl = new URL('/orders', req.url)
          const res = NextResponse.redirect(dashboardUrl)
          // Prevent browser from caching this redirect
          res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
          res.headers.set('Pragma', 'no-cache')
          return res
        }
      } catch {
        // Invalid token — let them see login
      }
    }
    // No session — allow access to /login, but add no-cache headers
    const res = NextResponse.next()
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
    return res
  }

  // 3. For all protected routes, require a valid session cookie
  const isApi = pathname.startsWith('/api/')

  if (!sessionCookie) {
    // Media/API clients cannot follow an HTML login redirect
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  try {
    // Validate session cookie structure: AES-256 CBC format is "ivHex:encryptedHex"
    const parts = sessionCookie.split(':')
    if (parts.length !== 2 || parts[0].length !== 32) {
      throw new Error('Invalid token structure')
    }

    // Token has correct structure; allow request
    const res = NextResponse.next()
    // Don't force no-store on media streams — breaks some browsers' audio buffering
    if (!pathname.includes('/recording')) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      res.headers.set('Pragma', 'no-cache')
    }
    return res
  } catch (error) {
    console.warn('Session verification failed in middleware, redirecting to login:', error)

    if (isApi) {
      const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      res.cookies.delete('fiberise_session')
      return res
    }

    const loginUrl = new URL('/login', req.url)
    const res = NextResponse.redirect(loginUrl)
    res.cookies.delete('fiberise_session')
    return res
  }
}

export const config = {
  matcher: [
    '/',
    '/orders/:path*',
    '/order-status/:path*',
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
