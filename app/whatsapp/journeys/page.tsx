'use client'

import { useState, useEffect, useCallback } from 'react'
import { SubNav } from '@/components/whatsapp/SubNav'
import { StatusBadge } from '@/components/whatsapp/StatusBadge'
import { fetchJourneys, updateJourneyStatus } from '@/lib/whatsappApi'
import {
  Loader2,
  Search,
  RefreshCw,
  Pause,
  Play,
  CheckCircle2,
  Route,
  Phone,
  Package,
  Calendar,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface JourneyRow {
  id: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  orderId: string
  orderAmount: number
  products: string[]
  currentDay: number
  nextMessageDate: string | null
  lastMessageSent: string
  status: string
  orderDate: string | null
  createdAt: string | null
}

export default function JourneysPage() {
  const [journeys, setJourneys] = useState<JourneyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadJourneys = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const data = await fetchJourneys(statusFilter)
      setJourneys(data || [])
    } catch (err) {
      console.error('Failed to fetch journeys:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadJourneys()
  }, [loadJourneys])

  const handleStatusChange = async (journeyId: string, newStatus: string) => {
    setActionLoading(journeyId)
    try {
      await updateJourneyStatus(journeyId, newStatus)
      await loadJourneys()
    } catch (err) {
      console.error('Failed to update journey:', err)
    } finally {
      setActionLoading(null)
    }
  }

  // Filter by search
  const filtered = journeys.filter((j) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      j.customerName.toLowerCase().includes(q) ||
      j.customerPhone.includes(q) ||
      j.orderId.toLowerCase().includes(q) ||
      j.products.some((p) => p.toLowerCase().includes(q))
    )
  })

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
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
                    <MessageSquare className="w-5 h-5 text-emerald-400" />
                  </div>
                  WhatsApp Journeys
                </h1>
                <p className="text-white/50 text-sm mt-1">
                  Monitor and manage automated WhatsApp customer journeys
                </p>
              </div>
              <button
                onClick={() => loadJourneys(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all"
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>

          {/* Sub Navigation */}
          <SubNav />

          {/* Filters */}
          <div className="bg-card rounded-2xl p-4 border border-white/10 mb-6">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
              {/* Search */}
              <div className="flex-1 w-full md:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="Search by customer, phone, order ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div className="flex gap-2">
                {['all', 'active', 'paused', 'completed'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                      statusFilter === s
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                <p className="text-white/50">Loading journeys...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-card rounded-2xl p-12 border border-white/10 text-center">
              <Route className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg mb-2">No Journeys Found</h3>
              <p className="text-white/30 text-sm">
                Journeys will appear here when customers place orders on Shopify.
              </p>
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Order</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Products</th>
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-white/40 uppercase tracking-wider">Day</th>
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold text-white/40 uppercase tracking-wider">Next Message</th>
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-white/40 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3.5 text-center text-[11px] font-bold text-white/40 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filtered.map((journey) => (
                      <tr
                        key={journey.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Customer */}
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-white font-semibold text-sm">{journey.customerName}</p>
                            <p className="text-white/40 text-xs flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3" />
                              {journey.customerPhone || '—'}
                            </p>
                          </div>
                        </td>

                        {/* Order */}
                        <td className="px-4 py-4">
                          <p className="text-white text-sm font-mono">{journey.orderId}</p>
                          <p className="text-emerald-400 text-xs font-bold mt-0.5">₹{journey.orderAmount}</p>
                        </td>

                        {/* Products */}
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {journey.products.slice(0, 2).map((p, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[11px] text-white/60"
                              >
                                <Package className="w-3 h-3" />
                                {p.length > 20 ? p.slice(0, 20) + '...' : p}
                              </span>
                            ))}
                            {journey.products.length > 2 && (
                              <span className="text-white/30 text-[11px]">
                                +{journey.products.length - 2} more
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Day */}
                        <td className="px-4 py-4 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-blue-500/15 border border-purple-500/20 text-white font-bold text-lg">
                            {journey.currentDay}
                          </span>
                        </td>

                        {/* Next Message */}
                        <td className="px-4 py-4">
                          <p className="text-white/60 text-xs flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(journey.nextMessageDate)}
                          </p>
                          {journey.lastMessageSent && (
                            <p className="text-white/30 text-[10px] mt-0.5">
                              Last: {journey.lastMessageSent}
                            </p>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4 text-center">
                          <StatusBadge status={journey.status} />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {actionLoading === journey.id ? (
                              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                            ) : (
                              <>
                                {journey.status === 'active' && (
                                  <button
                                    onClick={() => handleStatusChange(journey.id, 'paused')}
                                    className="p-2 rounded-lg hover:bg-amber-500/10 text-amber-400/60 hover:text-amber-400 transition-all"
                                    title="Pause Journey"
                                  >
                                    <Pause className="w-4 h-4" />
                                  </button>
                                )}
                                {journey.status === 'paused' && (
                                  <button
                                    onClick={() => handleStatusChange(journey.id, 'active')}
                                    className="p-2 rounded-lg hover:bg-emerald-500/10 text-emerald-400/60 hover:text-emerald-400 transition-all"
                                    title="Resume Journey"
                                  >
                                    <Play className="w-4 h-4" />
                                  </button>
                                )}
                                {journey.status !== 'completed' && (
                                  <button
                                    onClick={() => handleStatusChange(journey.id, 'completed')}
                                    className="p-2 rounded-lg hover:bg-blue-500/10 text-blue-400/60 hover:text-blue-400 transition-all"
                                    title="Mark Complete"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02]">
                <p className="text-white/30 text-xs">
                  Showing {filtered.length} of {journeys.length} journeys
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
