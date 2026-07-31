'use client'

import { Megaphone } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'

export default function MetaAnalyticsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center border border-indigo-500/30">
                <Megaphone className="w-5 h-5 text-indigo-400" />
              </div>
              Meta Analytics
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Digital marketing analytics for Meta ads and campaigns
            </p>
          </div>

          <div className="bg-card rounded-2xl border border-white/10 p-10 text-center">
            <p className="text-white/50 text-sm">
              Meta Analytics module coming soon.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
