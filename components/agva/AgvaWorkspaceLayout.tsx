'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const tabs = [
  { href: '/agva/calls', label: 'D&D Calls' },
  { href: '/agva/audit-logs', label: 'Audit Logs' },
]

export function AgvaWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()

  return (
    <main className="ml-0 lg:ml-64 p-4 lg:p-6 min-h-screen">
      <div className="max-w-[min(100%,90rem)] mx-auto mt-20 lg:mt-24">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 mb-1">
            Agva Health Tech
          </p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            D&amp;D Healthcare
          </h1>
          {user?.email ? (
            <p className="text-sm mt-1 capitalize" style={{ color: 'var(--foreground-muted)' }}>
              {user.email} · {user.role.replace(/_/g, ' ')}
            </p>
          ) : null}
        </header>

        <nav className="flex gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--sidebar-border)' }}>
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30'
                    : 'text-muted hover:bg-white/5'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        {children}
      </div>
    </main>
  )
}
