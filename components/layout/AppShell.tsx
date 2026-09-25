'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'

const CHROMELESS_PREFIXES = ['/login', '/get-token']

function isChromelessPath(pathname: string): boolean {
  return CHROMELESS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

/**
 * Persistent sidebar + top bar across client navigations (avoids remounting polls & layout).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''

  if (isChromelessPath(pathname)) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <Sidebar />
      <TopBar />
      {children}
    </div>
  )
}
