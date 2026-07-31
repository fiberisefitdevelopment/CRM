'use client'

import { Plane } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'

export default function AirExpressPage() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center border border-sky-500/30">
                <Plane className="w-5 h-5 text-sky-400" />
              </div>
              Air Express
            </h1>
            <p className="text-white/50 text-sm mt-1">
              Air express shipping and logistics
            </p>
          </div>

          <div className="bg-card rounded-2xl border border-white/10 p-10 text-center">
            <p className="text-white/50 text-sm">
              Air Express module coming soon.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
