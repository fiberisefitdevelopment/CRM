'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

const OrdersPanel = dynamic(
  () => import('@/components/orders/OrdersDashboard').then((m) => m.OrdersPanel),
  {
    loading: () => (
      <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto mt-20 flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      </main>
    ),
  },
)

export default function ShiprocketDashboardPage() {
  return <OrdersPanel />
}
