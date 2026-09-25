'use client'

import { useState, useEffect, useCallback } from 'react'
import { SubNav } from '@/components/whatsapp/SubNav'
import { StatsCard } from '@/components/whatsapp/StatsCard'
import { fetchAnalytics, getSchedulerStatus, triggerScheduler } from '@/lib/whatsappApi'
import {
  Loader2,
  RefreshCw,
  BarChart3,
  Send,
  CheckCircle2,
  XCircle,
  Users,
  Route,
  TrendingUp,
  Zap,
  Clock,
  Activity,
  Play,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Analytics {
  totalMessages: number
  deliveredMessages: number
  failedMessages: number
  activeJourneys: number
  completedJourneys: number
  totalCustomers: number
  journeyCompletionRate: number
}

interface SchedulerStatusData {
  running: boolean
  currentlyProcessing: boolean
  lastRunAt: string | null
  lastRunStats: any
  schedule: string
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [scheduler, setScheduler] = useState<SchedulerStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [analyticsData, schedulerData] = await Promise.all([
        fetchAnalytics(),
        getSchedulerStatus(),
      ])
      setAnalytics(analyticsData)
      setScheduler(schedulerData)
    } catch (err) {
      console.error('Failed to load analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleTriggerScheduler = async () => {
    setTriggering(true)
    try {
      await triggerScheduler()
      await loadData()
    } catch (err) {
      console.error('Scheduler trigger failed:', err)
    } finally {
      setTriggering(false)
    }
  }

  const deliveryRate =
    analytics && analytics.totalMessages > 0
      ? Math.round((analytics.deliveredMessages / analytics.totalMessages) * 100)
      : 0

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-500/30">
                    <BarChart3 className="w-5 h-5 text-emerald-400" />
                  </div>
                  Analytics Dashboard
                </h1>
                <p className="text-white/50 text-sm mt-1">
                  Overview of WhatsApp journey performance and delivery metrics
                </p>
              </div>
              <button
                onClick={loadData}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>

          {/* Sub Navigation */}
          <SubNav />

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                <p className="text-white/50">Loading analytics...</p>
              </div>
            </div>
          ) : analytics ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatsCard
                  title="Total Messages"
                  value={analytics.totalMessages}
                  icon={Send}
                  gradient="purple"
                />
                <StatsCard
                  title="Delivered"
                  value={analytics.deliveredMessages}
                  icon={CheckCircle2}
                  gradient="emerald"
                  trend={`${deliveryRate}% rate`}
                  trendUp={deliveryRate >= 80}
                />
                <StatsCard
                  title="Failed"
                  value={analytics.failedMessages}
                  icon={XCircle}
                  gradient="red"
                />
                <StatsCard
                  title="Total Customers"
                  value={analytics.totalCustomers}
                  icon={Users}
                  gradient="blue"
                />
              </div>

              {/* Journey Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <StatsCard
                  title="Active Journeys"
                  value={analytics.activeJourneys}
                  icon={Route}
                  gradient="amber"
                />
                <StatsCard
                  title="Completed Journeys"
                  value={analytics.completedJourneys}
                  icon={CheckCircle2}
                  gradient="teal"
                />
                <StatsCard
                  title="Completion Rate"
                  value={`${analytics.journeyCompletionRate}%`}
                  icon={TrendingUp}
                  gradient="purple"
                  trend={analytics.journeyCompletionRate >= 50 ? 'On track' : 'Needs improvement'}
                  trendUp={analytics.journeyCompletionRate >= 50}
                />
              </div>

              {/* Delivery Funnel + Scheduler Status */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Delivery Funnel */}
                <div className="bg-card rounded-2xl p-6 border border-white/10">
                  <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    Delivery Funnel
                  </h3>

                  <div className="space-y-4">
                    {/* Total */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/60 text-sm font-medium">Total Sent</span>
                        <span className="text-white font-bold">{analytics.totalMessages}</span>
                      </div>
                      <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-1000"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    {/* Delivered */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/60 text-sm font-medium">Delivered</span>
                        <span className="text-emerald-400 font-bold">{analytics.deliveredMessages}</span>
                      </div>
                      <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-1000"
                          style={{
                            width: `${analytics.totalMessages > 0 ? (analytics.deliveredMessages / analytics.totalMessages) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Failed */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/60 text-sm font-medium">Failed</span>
                        <span className="text-red-400 font-bold">{analytics.failedMessages}</span>
                      </div>
                      <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-500 to-rose-500 rounded-full transition-all duration-1000"
                          style={{
                            width: `${analytics.totalMessages > 0 ? (analytics.failedMessages / analytics.totalMessages) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="mt-6 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-white/40 text-sm">Delivery Rate</span>
                      <span
                        className={cn(
                          'text-lg font-bold',
                          deliveryRate >= 80 ? 'text-emerald-400' : deliveryRate >= 50 ? 'text-amber-400' : 'text-red-400'
                        )}
                      >
                        {deliveryRate}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Scheduler Status */}
                <div className="bg-card rounded-2xl p-6 border border-white/10">
                  <h3 className="text-white font-bold text-lg mb-6 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400" />
                    Scheduler Status
                  </h3>

                  <div className="space-y-4">
                    {/* Status */}
                    <div className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                      <span className="text-white/60 text-sm">Status</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            scheduler?.running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                          )}
                        />
                        <span className={cn('text-sm font-bold', scheduler?.running ? 'text-emerald-400' : 'text-red-400')}>
                          {scheduler?.running ? 'Running' : 'Stopped'}
                        </span>
                      </div>
                    </div>

                    {/* Schedule */}
                    <div className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                      <span className="text-white/60 text-sm flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Schedule
                      </span>
                      <span className="text-white/80 text-sm font-mono">Every hour at :00</span>
                    </div>

                    {/* Last Run */}
                    <div className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                      <span className="text-white/60 text-sm">Last Run</span>
                      <span className="text-white/80 text-sm">{formatDate(scheduler?.lastRunAt || null)}</span>
                    </div>

                    {/* Last Run Stats */}
                    {scheduler?.lastRunStats && (
                      <div className="px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                        <p className="text-white/60 text-xs font-semibold mb-3 uppercase tracking-wider">Last Run Results</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="text-center">
                            <p className="text-xl font-bold text-white">{scheduler.lastRunStats.processed || 0}</p>
                            <p className="text-white/30 text-[10px] uppercase">Processed</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-bold text-emerald-400">{scheduler.lastRunStats.sent || 0}</p>
                            <p className="text-white/30 text-[10px] uppercase">Sent</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-bold text-amber-400">{scheduler.lastRunStats.skipped || 0}</p>
                            <p className="text-white/30 text-[10px] uppercase">Skipped</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-bold text-red-400">{scheduler.lastRunStats.failed || 0}</p>
                            <p className="text-white/30 text-[10px] uppercase">Failed</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Manual Trigger */}
                    <button
                      onClick={handleTriggerScheduler}
                      disabled={triggering || scheduler?.currentlyProcessing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 rounded-xl text-amber-400 font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {triggering ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          Trigger Scheduler Now
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-card rounded-2xl p-12 border border-white/10 text-center">
              <BarChart3 className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg mb-2">No Analytics Data</h3>
              <p className="text-white/30 text-sm">
                Analytics will appear here once messages start being sent.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
