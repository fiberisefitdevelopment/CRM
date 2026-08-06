'use client'

import { Plane } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/air-express/SubNav'

export function AirExpressShell({
  title,
  subtitle,
  badge = 'Aaysh Express',
  actions,
  children,
}: {
  title: string
  subtitle?: string
  badge?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <Sidebar />
      <TopBar />
      <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold badge-info">{badge}</span>
              </div>
              <h1
                className="text-2xl lg:text-3xl font-extrabold tracking-tight flex items-center gap-2"
                style={{ color: 'var(--foreground)' }}
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center border border-sky-500/30">
                  <Plane className="w-5 h-5 text-sky-500" />
                </div>
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </div>
          <SubNav />
          {children}
        </div>
      </main>
    </div>
  )
}

// Backward-compatible exports
export { airExpressInputClass } from '@/components/air-express/ui'
export const airExpressSectionClass = 'crm-card p-5'
