'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Package,
  PackagePlus,
  Upload,
  Truck,
  Users,
  MapPin,
  FileText,
  Search,
} from 'lucide-react'

const tabs = [
  { label: 'Orders', href: '/air-express/orders', icon: Package },
  { label: 'Create Order', href: '/air-express/create-order', icon: PackagePlus },
  { label: 'Bulk Import', href: '/air-express/bulk-import', icon: Upload },
  { label: 'Shipments', href: '/air-express/shipments', icon: Truck },
  { label: 'Couriers & AWB', href: '/air-express/couriers', icon: Users },
  { label: 'Pickups', href: '/air-express/pickups', icon: MapPin },
  { label: 'Documents', href: '/air-express/documents', icon: FileText },
  { label: 'Tracking', href: '/air-express/tracking', icon: Search },
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
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 border',
              isActive
                ? 'bg-gradient-to-r from-sky-500/15 to-blue-500/15 border-sky-500/30 shadow-sm text-sky-700 dark:text-sky-100'
                : 'border-transparent text-muted hover:text-theme hover:bg-black/5 dark:hover:bg-white/5',
            )}
            style={!isActive ? { color: 'var(--foreground-muted)' } : undefined}
          >
            <Icon className={cn('w-4 h-4', isActive ? 'text-sky-500' : '')} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
