'use client'

import { OrdersPanel } from '@/components/orders/OrdersDashboard'

/** Same Orders panel, locked to the care-confirmed queue. */
export default function ConfirmedOrdersPage() {
  return <OrdersPanel lockedTab="confirmed" />
}
