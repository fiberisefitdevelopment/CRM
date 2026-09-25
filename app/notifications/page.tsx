'use client'

import { NotificationPush } from '@/components/notifications/NotificationPush'

export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-4xl mx-auto mt-20">
          <NotificationPush />
        </div>
      </main>
    </div>
  )
}
