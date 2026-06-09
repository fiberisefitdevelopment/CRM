'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import dynamic from 'next/dynamic'
import { FilteredUsersTable } from '@/components/dashboard/FilteredUsersTable'
import { ErrorToast } from '@/components/ErrorToast'
import { useUsers } from '@/hooks/useUsers'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { MapPin, Filter, X, Loader2, Search, ArrowUpDown, Users, UserCheck, UserX } from 'lucide-react'
import { CustomDropdown } from '@/components/dashboard/CustomDropdown'
import { reverseGeocode } from '@/lib/geocoding'

// Dynamically import UserMap to avoid SSR issues
const UserMap = dynamic(() => import('@/components/dashboard/UserMap').then(mod => ({ default: mod.UserMap })), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-card">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
        <p className="text-white/60">Loading map...</p>
      </div>
    </div>
  ),
})

// Helper to extract coordinates from a user document
function extractCoords(user: any): { latitude: number; longitude: number } | null {
  // Case 1: Direct latitude/longitude fields
  if (typeof user.latitude === 'number' && typeof user.longitude === 'number') {
    return { latitude: user.latitude, longitude: user.longitude }
  }
  
  // Case 2: Nested location map (location.latitude, location.longitude)
  if (user.location && typeof user.location.latitude === 'number' && typeof user.location.longitude === 'number') {
    return { latitude: user.location.latitude, longitude: user.location.longitude }
  }
  
  // Case 3: String field like "28.536761, 77.381319"
  if (typeof user.userLocation === 'string') {
    const parts = user.userLocation.split(',')
    if (parts.length === 2) {
      const lat = parseFloat(parts[0].trim())
      const lng = parseFloat(parts[1].trim())
      if (!isNaN(lat) && !isNaN(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }
  }
  return null
}

export default function Dashboard() {
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'state' | 'city'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const { users, loading, error: usersError } = useUsers()

  // Calculate user statistics
  const userStats = useMemo(() => {
    const totalUsers = users.length
    const subscribedUsers = users.filter((user: any) => {
      // Check if user has any FCM token field
      const hasToken = 
        (user.fcmToken && typeof user.fcmToken === 'string' && user.fcmToken.trim() !== '') ||
        (user.pushToken && typeof user.pushToken === 'string' && user.pushToken.trim() !== '') ||
        (user.notificationToken && typeof user.notificationToken === 'string' && user.notificationToken.trim() !== '') ||
        (user.fcm_token && typeof user.fcm_token === 'string' && user.fcm_token.trim() !== '') ||
        (user.push_token && typeof user.push_token === 'string' && user.push_token.trim() !== '') ||
        (user.deviceToken && typeof user.deviceToken === 'string' && user.deviceToken.trim() !== '')
      return hasToken
    }).length
    const unsubscribedUsers = totalUsers - subscribedUsers
    
    return {
      total: totalUsers,
      subscribed: subscribedUsers,
      unsubscribed: unsubscribedUsers,
    }
  }, [users])

  // Users enriched with state/city resolved from latitude/longitude
  const [geoUsers, setGeoUsers] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    const enrichUsers = async () => {
      if (!users || users.length === 0) {
        setGeoUsers([])
        return
      }

      // Batch geocoding for better performance
      const coordinatesToFetch: Array<{ user: any; lat: number; lng: number }> = []
      const usersWithoutCoords: any[] = []

      users.forEach((user: any) => {
        const coords = extractCoords(user)
        if (!coords) {
          usersWithoutCoords.push({
            ...user,
            resolvedState: user.state || null,
            resolvedCity: user.city || null,
          })
        } else {
          coordinatesToFetch.push({ user, lat: coords.latitude, lng: coords.longitude })
        }
      })

      // Batch geocode all coordinates at once
      const { reverseGeocodeBatch } = await import('@/lib/geocoding')
      const geoResults = await reverseGeocodeBatch(
        coordinatesToFetch.map(({ lat, lng }) => ({ lat, lng }))
      )

      const enriched = [
        ...usersWithoutCoords,
        ...coordinatesToFetch.map(({ user, lat, lng }) => {
          const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
          const geo = geoResults.get(key)
          return {
            ...user,
            resolvedState: geo?.state || user.state || null,
            resolvedCity: geo?.city || user.city || null,
          }
        }),
      ]

      if (!cancelled) {
        setGeoUsers(enriched)
      }
    }

    enrichUsers()

    return () => {
      cancelled = true
    }
  }, [users])

  // Get unique states from resolved geocoded users
  const indianStates = useMemo(() => {
    return Array.from(
      new Set(
        geoUsers
          .map((u) => u.resolvedState)
          .filter((s): s is string => Boolean(s))
      )
    ).sort()
  }, [geoUsers])

  // Get unique cities (optionally filtered by state) from resolved geocoded users
  const availableCities = useMemo(() => {
    const source = selectedState
      ? geoUsers.filter((u) => u.resolvedState === selectedState && u.resolvedCity)
      : geoUsers.filter((u) => u.resolvedCity)

    return Array.from(
      new Set(source.map((u) => u.resolvedCity as string))
    ).sort()
  }, [selectedState, geoUsers])

  // Handle errors
  useEffect(() => {
    if (usersError) setError(usersError)
  }, [usersError])

  // Handle marker click from map
  const handleMarkerClick = useCallback((userId: string) => {
    setHighlightedUserId(userId)
    // Scroll to table and highlight row
    setTimeout(() => {
      const element = document.getElementById(`user-row-${userId}`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }, [])

  // Handle row click from table
  const handleRowClick = useCallback((userId: string) => {
    setHighlightedUserId(userId)
  }, [])


  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar />
        <TopBar />
        <main className="ml-0 lg:ml-64 p-4 lg:p-6">
          <div className="max-w-7xl mx-auto mt-20">
            <div className="flex items-center justify-center h-[600px]">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
                <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading users...</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
                  Health Monitoring Dashboard
                </h1>
                <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                  Monitor users across locations in real-time
                </p>
              </div>
            </div>
          </div>

          {/* User Statistics Tiles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Total Users */}
            <div className="crm-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--foreground-muted)' }}>Total Users</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{userStats.total}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/30">
                  <Users className="w-6 h-6 text-purple-500" />
                </div>
              </div>
            </div>

            {/* Subscribed Users */}
            <div className="crm-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--foreground-muted)' }}>Subscribed Users</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{userStats.subscribed}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center border border-green-500/30">
                  <UserCheck className="w-6 h-6 text-green-500" />
                </div>
              </div>
            </div>

            {/* Unsubscribed Users */}
            <div className="crm-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--foreground-muted)' }}>Unsubscribed Users</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{userStats.unsubscribed}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center border border-orange-500/30">
                  <UserX className="w-6 h-6 text-orange-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Map Section */}
          <div className="mb-6">
            <div className="crm-card p-6">
              <h2 className="font-semibold text-xl mb-4" style={{ color: 'var(--foreground)' }}>User Location Map</h2>
              <UserMap
                users={geoUsers}
                selectedState={selectedState}
                selectedCity={selectedCity}
                onMarkerClick={handleMarkerClick}
                highlightedUserId={highlightedUserId}
              />
            </div>
          </div>

          {/* Search, Sort, and Filter Section */}
          <div className="crm-card p-6 mb-6">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              {/* Search Bar */}
              <div className="flex-1 w-full lg:w-auto" style={{ color: 'var(--foreground)' }}>
                <label className="block text-white/60 text-xs mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    placeholder="Search by name, email, phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:border-purple-500/50"
                  />
                </div>
              </div>

              {/* State Filter */}
              <div className="flex-1 lg:flex-initial">
                <label className="block text-white/60 text-xs mb-2">State</label>
                <CustomDropdown
                  options={indianStates}
                  value={selectedState}
                  onChange={setSelectedState}
                  placeholder="All States"
                  icon={<MapPin className="w-4 h-4 text-white/40" />}
                  className="w-full lg:w-48"
                />
              </div>

              {/* City Filter */}
              <div className="flex-1 lg:flex-initial">
                <label className="block text-white/60 text-xs mb-2">City</label>
                <CustomDropdown
                  options={availableCities as string[]}
                  value={selectedCity}
                  onChange={setSelectedCity}
                  placeholder="All Cities"
                  disabled={availableCities.length === 0}
                  icon={<MapPin className="w-4 h-4 text-white/40" />}
                  className="w-full lg:w-48"
                />
              </div>

              {/* Sort By */}
              <div className="flex-1 lg:flex-initial">
                <label className="block text-white/60 text-xs mb-2">Sort By</label>
                <div className="relative">
                  <ArrowUpDown className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'name' | 'state' | 'city')}
                    className="w-full lg:w-40 pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50 appearance-none cursor-pointer"
                  >
                    <option value="name" className="bg-card">Name</option>
                    <option value="state" className="bg-card">State</option>
                    <option value="city" className="bg-card">City</option>
                  </select>
                </div>
              </div>

              {/* Sort Order */}
              <div className="flex-1 lg:flex-initial">
                <label className="block text-white/60 text-xs mb-2">Order</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                  className="w-full lg:w-32 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/50 appearance-none cursor-pointer"
                >
                  <option value="asc" className="bg-card">Ascending</option>
                  <option value="desc" className="bg-card">Descending</option>
                </select>
              </div>

              {/* Clear Filters */}
              {(selectedState || selectedCity || searchQuery) && (
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setSelectedState(null)
                      setSelectedCity(null)
                      setSearchQuery('')
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white text-sm font-medium transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* User List Table */}
          <div className="crm-card mb-6">
            <FilteredUsersTable
              users={geoUsers}
              selectedState={selectedState}
              selectedCity={selectedCity}
              searchQuery={searchQuery}
              sortBy={sortBy}
              sortOrder={sortOrder}
              highlightedUserId={highlightedUserId}
              onRowClick={handleRowClick}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
