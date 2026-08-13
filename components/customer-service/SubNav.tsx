'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Phone,
  Headphones,
  ScrollText,
  BarChart3,
  ListTodo,
  PackageCheck,
} from 'lucide-react'

const tabs = [
  { label: 'Dashboard', href: '/customer-service/dashboard', icon: LayoutDashboard },
  { label: 'Customer Care Tasks', href: '/customer-service/care-tasks', icon: ListTodo },
  { label: 'Delivered Orders', href: '/customer-service/delivered-orders', icon: PackageCheck },
  { label: 'Call History', href: '/customer-service/call-history', icon: Phone },
  { label: 'Recordings', href: '/customer-service/recordings', icon: Headphones },
  { label: 'Integration Logs', href: '/customer-service/integration-logs', icon: ScrollText },
  { label: 'Analytics', href: '/customer-service/analytics', icon: BarChart3 },
]

export function SubNav() {
  const pathname = usePathname()

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)

        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
              isActive
                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30 shadow-lg shadow-purple-500/10'
                : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent',
            )}
          >
            <Icon className={cn('w-4 h-4', isActive ? 'text-purple-400' : 'text-white/40')} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
