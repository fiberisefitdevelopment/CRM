'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { db } from '@/src/firebase'
import { doc, getDoc } from 'firebase/firestore'
import { useHealthMetrics } from '@/hooks/useHealthMetrics'
import { ArrowLeft, User, Phone, Calendar, AlertCircle, Filter, Calendar as CalendarIcon, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'

// Code split heavy chart components
const HealthMetricsChart = dynamic(
  () => import('@/components/dashboard/HealthMetricsChart').then(mod => ({ default: mod.HealthMetricsChart })),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-[400px] rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-card">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading chart...</p>
        </div>
      </div>
    )
  }
)

const DailyHealthView = dynamic(
  () => import('@/components/dashboard/DailyHealthView').then(mod => ({ default: mod.DailyHealthView })),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-[400px] rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-card">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading daily view...</p>
        </div>
      </div>
    )
  }
)

const MetricDetailView = dynamic(
  () => import('@/components/dashboard/MetricDetailView').then(mod => ({ default: mod.MetricDetailView })),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-[400px] rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-card">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading metric details...</p>
        </div>
      </div>
    )
  }
)

const HourlyDataView = dynamic(
  () => import('@/components/dashboard/HourlyDataView').then(mod => ({ default: mod.HourlyDataView })),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-[400px] rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-card">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading hourly data...</p>
        </div>
      </div>
    )
  }
)

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params?.id as string
  
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter states
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  })
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [selectedDateForHourly, setSelectedDateForHourly] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  
  // Metric visibility toggles
  const [visibleMetrics, setVisibleMetrics] = useState({
    blood_oxygen: true,
    sleep: true,
    stress: true,
    hrv: true,
    heart_rate: true,
    steps: true,
  })

  // Fetch health metrics
  const { metrics, loading: metricsLoading, error: metricsError, mergeMetricsByDate, getDailyStats } = useHealthMetrics(userId)

  // Fetch user data
  useEffect(() => {
    const fetchUserData = async () => {
      if (!userId) {
        setError('No user ID provided')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        
        const decodedUserId = decodeURIComponent(userId)
        const userDocRef = doc(db, 'users', decodedUserId)
        const userDoc = await getDoc(userDocRef)
        
        if (!userDoc.exists()) {
          setError(`User not found with ID: ${decodedUserId}`)
          setLoading(false)
          return
        }
        
        setUser({
          id: userDoc.id,
          ...userDoc.data()
        })
      } catch (err: any) {
        setError(`Error fetching user: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    fetchUserData()
  }, [userId])

  // Merge and filter data based on date range
  const mergedData = useMemo(() => {
    return mergeMetricsByDate(dateRange.start || undefined, dateRange.end || undefined)
  }, [mergeMetricsByDate, dateRange])


  // Get daily stats for selected day
  const dailyStats = useMemo(() => {
    if (!selectedDay) return null
    return getDailyStats(selectedDay)
  }, [selectedDay, getDailyStats])

  // Filter metrics by selected date for Data Summary
  const filteredMetricsForSummary = useMemo(() => {
    if (!selectedDay) {
      // If no date selected, return all metrics
      return metrics
    }

    // Helper to check if a timestamp matches the selected day
    const isSameDay = (timestamp: Date, selectedDate: Date): boolean => {
      const tsDate = timestamp instanceof Date ? timestamp : new Date(timestamp)
      const selDate = selectedDate instanceof Date ? selectedDate : new Date(selectedDate)
      
      return (
        tsDate.getFullYear() === selDate.getFullYear() &&
        tsDate.getMonth() === selDate.getMonth() &&
        tsDate.getDate() === selDate.getDate()
      )
    }

    // Filter each metric array to only include records for the selected day
    return {
      blood_oxygen: metrics.blood_oxygen.filter(item => isSameDay(item.timestamp, selectedDay)),
      sleep: metrics.sleep.filter(item => isSameDay(item.timestamp, selectedDay)),
      stress: metrics.stress.filter(item => isSameDay(item.timestamp, selectedDay)),
      hrv: metrics.hrv.filter(item => isSameDay(item.timestamp, selectedDay)),
      heart_rate: metrics.heart_rate.filter(item => isSameDay(item.timestamp, selectedDay)),
      steps: metrics.steps.filter(item => isSameDay(item.timestamp, selectedDay)),
    }
  }, [metrics, selectedDay])

  const sleepSessions = useMemo(() => {
    const sessions: { date: string; start: Date; end: Date; hours: number }[] = []
    metrics.sleep.forEach((item: any) => {
      if (!item.sleepStart || !item.sleepEnd) return
      const start = new Date(item.sleepStart)
      const end = new Date(item.sleepEnd)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
      const dateKey = start.toISOString().split('T')[0]
      const existingIndex = sessions.findIndex((s) => s.date === dateKey)
      if (existingIndex >= 0) {
        if (hours > sessions[existingIndex].hours) {
          sessions[existingIndex] = { date: dateKey, start, end, hours }
        }
      } else {
        sessions.push({ date: dateKey, start, end, hours })
      }
    })
    return sessions.sort((a, b) => b.start.getTime() - a.start.getTime())
  }, [metrics.sleep])

  // Handle date click from merged data table
  const handleDateClick = useCallback((date: Date) => {
    setSelectedDateForHourly(date)
    setSelectedDay(date) // Also set as selected day for daily view
  }, [])

  // Listen for custom event from MetricDetailView
  useEffect(() => {
    const handleOpenHourlyView = (event: any) => {
      if (event.detail?.date) {
        handleDateClick(event.detail.date)
      }
    }

    window.addEventListener('openHourlyView', handleOpenHourlyView as EventListener)
    return () => {
      window.removeEventListener('openHourlyView', handleOpenHourlyView as EventListener)
    }
  }, [handleDateClick])

  // Format date for input
  const formatDateForInput = useCallback((date: Date): string => {
    return date.toISOString().split('T')[0]
  }, [])

  // Handle date range changes
  const handleStartDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null
    setDateRange((prev) => ({ ...prev, start: date }))
    setSelectedDay(null) // Clear selected day when range changes
  }, [])

  const handleEndDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null
    setDateRange((prev) => ({ ...prev, end: date }))
    setSelectedDay(null) // Clear selected day when range changes
  }, [])

  // Handle single day selection
  const handleDaySelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null
    setSelectedDay(date)
    if (date) {
      // Set date range to the selected day
      const start = new Date(date)
      start.setHours(0, 0, 0, 0)
      const end = new Date(date)
      end.setHours(23, 59, 59, 999)
      setDateRange({ start, end })
    }
  }, [])

  // Clear filters
  const clearFilters = useCallback(() => {
    setDateRange({ start: null, end: null })
    setSelectedDay(null)
  }, [])

  // Toggle metric visibility
  const toggleMetric = useCallback((metric: keyof typeof visibleMetrics) => {
    setVisibleMetrics((prev) => ({
      ...prev,
      [metric]: !prev[metric],
    }))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-white text-xl">Loading user data...</div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl p-8 border border-red-500/50 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Error</h2>
          <p className="text-white/60 mb-6">{error || 'User not found'}</p>
          <button
            onClick={() => router.push('/')}
            className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-white/60 hover:text-white mb-4 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Dashboard</span>
            </button>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                  {user.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white">{user.name || 'Unknown User'}</h1>
                  <p className="text-white/60 text-sm">ID: {user.id}</p>
                </div>
              </div>
              
              {/* Date Picker */}
              <div className="relative">
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white transition-colors text-sm"
                >
                  <Calendar className="w-4 h-4" />
                  <span>
                    {selectedDay
                      ? selectedDay.toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Select date...'}
                  </span>
                </button>

                {showDatePicker && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowDatePicker(false)}
                    />
                    <div className="absolute top-full right-0 mt-2 bg-card border border-white/10 rounded-lg shadow-xl z-20 p-4 min-w-[320px]">
                      <input
                        type="date"
                        value={selectedDay ? formatDateForInput(selectedDay) : ''}
                        onChange={(e) => {
                          const date = e.target.value ? new Date(e.target.value) : null
                          if (date) {
                            handleDateClick(date)
                            setShowDatePicker(false)
                          }
                        }}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
                        min={mergedData.length > 0 ? (() => {
                          const firstDate = mergedData[0]?.timestamp instanceof Date 
                            ? mergedData[0].timestamp 
                            : new Date(mergedData[0]?.timestamp || Date.now())
                          return formatDateForInput(firstDate)
                        })() : undefined}
                        max={mergedData.length > 0 ? (() => {
                          const lastDate = mergedData[mergedData.length - 1]?.timestamp instanceof Date 
                            ? mergedData[mergedData.length - 1].timestamp 
                            : new Date(mergedData[mergedData.length - 1]?.timestamp || Date.now())
                          return formatDateForInput(lastDate)
                        })() : undefined}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* User Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-card rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-2">
                <Phone className="w-5 h-5 text-white/60" />
                <span className="text-white/60 text-sm">Phone</span>
              </div>
              <p className="text-white text-xl font-semibold">{user.phone || 'N/A'}</p>
            </div>
            
            <div className="bg-card rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-white/60" />
                <span className="text-white/60 text-sm">Gender</span>
              </div>
              <p className="text-white text-xl font-semibold">{user.gender || 'N/A'}</p>
            </div>
            
            <div className="bg-card rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-5 h-5 text-white/60" />
                <span className="text-white/60 text-sm">Age</span>
              </div>
              <p className="text-white text-xl font-semibold">
                {user.age || 'N/A'} {user.age ? 'years' : ''}
              </p>
            </div>
            
            <div className="bg-card rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-5 h-5 text-white/60" />
                <span className="text-white/60 text-sm">BMI</span>
              </div>
              <p className="text-white text-xl font-semibold">{user.bmi || 'N/A'}</p>
            </div>
          </div>

          {/* Error Display */}
          {metricsError && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-6">
              <p className="text-red-400 text-sm">{metricsError}</p>
            </div>
          )}



          {/* Sleep Sessions (day wise) */}
          <div className="bg-card rounded-2xl p-6 border border-white/10 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-xs text-purple-300">
                  Zz
                </span>
                <h3 className="text-white font-semibold text-sm">Sleep Sessions</h3>
              </div>
              <span className="text-white/40 text-xs">Last {Math.min(7, sleepSessions.length)} day(s)</span>
            </div>
            {sleepSessions.length === 0 ? (
              <p className="text-white/50 text-sm">No sleep data available.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                {sleepSessions.slice(0, 14).map((s) => (
                  <div key={s.date} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0">
                    <div className="text-white/70">
                      {new Date(s.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/70">
                      <span>Sleep: {new Date(s.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>Wake: {new Date(s.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-200">
                        {s.hours.toFixed(1)} hrs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Daily In-Depth View */}
          {selectedDay && dailyStats && (
            <div className="mb-6">
              <DailyHealthView stats={dailyStats} date={selectedDay} />
            </div>
          )}


          {/* Data Summary */}
          <div className="bg-card rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-xl">Data Summary</h3>
              {selectedDay && (
                <span className="text-white/60 text-sm">
                  Showing data for: {selectedDay.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.blood_oxygen.length > 0 ? 'blood_oxygen' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">Blood Oxygen</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.blood_oxygen.length} records
                </p>
              </button>
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.sleep.length > 0 ? 'sleep' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">Sleep</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.sleep.length} records
                </p>
              </button>
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.stress.length > 0 ? 'stress' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">Stress</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.stress.length} records
                </p>
              </button>
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.hrv.length > 0 ? 'hrv' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">HRV</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.hrv.length} records
                </p>
              </button>
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.heart_rate.length > 0 ? 'heart_rate' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">Heart Rate</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.heart_rate.length} records
                </p>
              </button>
              <button
                onClick={() => setSelectedMetric(filteredMetricsForSummary.steps.length > 0 ? 'steps' : null)}
                className="text-left p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-purple-500/50 transition-all cursor-pointer"
              >
                <p className="text-white/60 text-sm mb-1">Steps</p>
                <p className="text-white text-lg font-semibold">
                  {filteredMetricsForSummary.steps.length} records
                </p>
              </button>
            </div>
          </div>

          {/* Metric Detail View */}
          {selectedMetric && filteredMetricsForSummary[selectedMetric as keyof typeof filteredMetricsForSummary].length > 0 && (
            <div className="mt-6">
              <MetricDetailView
                metricName={selectedMetric}
                data={filteredMetricsForSummary[selectedMetric as keyof typeof filteredMetricsForSummary]}
                onClose={() => setSelectedMetric(null)}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
