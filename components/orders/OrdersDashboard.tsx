'use client'

import { apiFetch } from '@/lib/auth'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { getPaymentLabel, isCodOrder } from '@/src/utils/orderPayment'
import {
  fulfillmentStageLabel,
  isActiveRtoStatus,
  normalizeShipmentStatus,
  toIstDateKey,
} from '@/src/utils/orderTimeline'
import {
  Loader2,
  RefreshCw,
  Search,
  Calendar,
  SlidersHorizontal,
  X,
  Truck,
  Package,
  MapPin,
  Eye,
  EyeOff,
  ShieldAlert,
  Award,
  Sparkles,
  Compass,
  ArrowLeftRight,
  CheckCircle2,
  ChevronRight,
  Activity,
  Plane,
  Plus,
  TrendingDown,
  Info,
  Download,
  AlertCircle,
  User,
  CreditCard,
  ShoppingCart,
  ArrowLeft,
  Filter,
  Trash2,
  MoreHorizontal
} from 'lucide-react'
import { CareOrderTagBadge } from '@/components/orders/CareOrderTagBadge'
import { AirExpressDocumentsButtons } from '@/components/orders/AirExpressDocumentsButtons'
import type { CareOrderTagEntry } from '@/src/utils/careOrderTags'
import { isAirExpressOrder } from '@/src/utils/airExpressOrder'
import {
  downloadAirExpressDocument,
  openAirExpressPdf,
} from '@/lib/airExpressApi'
import type { AayshPdfType } from '@/src/services/aayshExpressClient'

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface LineItem {
  id: number
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  price: string
  total_discount: string
  fulfillment_status: string | null
}

interface Address {
  first_name?: string
  last_name?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  country?: string
  zip?: string
  phone?: string
}

function getOrderShippingAddress(order: ShopifyOrder): Address | null | undefined {
  return order.shipping_address || order.billing_address
}

function formatShippingAddressFull(addr?: Address | null): string {
  if (!addr) return 'N/A'
  return [
    addr.address1,
    addr.address2,
    [addr.city, addr.province].filter(Boolean).join(', ') + (addr.zip ? ` - ${addr.zip}` : ''),
    addr.country,
  ]
    .filter(Boolean)
    .join('\n')
}

interface ShopifyOrder {
  id: number
  name: string
  created_at: string
  financial_status: string
  /** Shiprocket payment method when enriched: 'cod' | 'prepaid' */
  payment_method?: string | null
  fulfillment_status: string | null
  total_price: string
  currency: string
  cancelled_at?: string | null
  care_tag?: CareOrderTagEntry | null
  customer?: {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
  } | null
  shipping_address?: Address | null
  billing_address?: Address | null
  line_items: LineItem[]
  fulfillments?: Array<{
    id: number
    status: string
    tracking_number: string | null
    tracking_company: string | null
    tracking_url: string | null
    shipment_status: string | null
    shipment_status_reason?: string | null
    created_at: string
    dispatch_date?: string | null
    delivery_date?: string | null
  }>
  source?: string
  is_test_order?: boolean
  airExpressOrderId?: string | null
  airExpressShipmentId?: string | null
  logistics?: string | null
}

interface ManifestRecord {
  id: string
  date: string
  shipmentCount: number
  address: string
  courier: string
  status: string
  manifestName: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Badge({ label, variant = 'default' }: { label: string; variant?: 'green' | 'yellow' | 'red' | 'blue' | 'default' }) {
  const colors = {
    green:   'badge-success',
    yellow:  'badge-warning',
    red:     'badge-danger',
    blue:    'badge-info',
    default: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-white/70 dark:border-white/10',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[variant]}`}>
      {label}
    </span>
  )
}

function isAeShippedOrder(order: ShopifyOrder | any): boolean {
  if (!order) return false
  if (isAirExpressOrder(order) || order.logistics === 'air_express') return true
  const company = String(order.fulfillments?.[0]?.tracking_company || '').toLowerCase()
  return company.includes('air express') || company.includes('aaysh')
}

function statusVariant(status: string | null): 'green' | 'yellow' | 'red' | 'blue' | 'default' {
  if (!status) return 'default'
  const s = status.toLowerCase()
  if (['paid', 'fulfilled', 'delivered', 'ready to ship'].some(v => s.includes(v))) return 'green'
  if (['pending', 'partial', 'in_transit', 'out_for_delivery', 'attempted', 'pickup scheduled', 'out for pickup'].some(v => s.includes(v))) return 'yellow'
  if (['refunded', 'voided', 'cancelled', 'failed', 'failure', 'rto', 'returned'].some(v => s.includes(v))) return 'red'
  if (['authorized', 'confirmed', 'label printed'].some(v => s.includes(v))) return 'blue'
  return 'default'
}

function isOrderCancelled(order: ShopifyOrder): boolean {
  return (
    !!(order as any).cancelled_at ||
    order.financial_status?.toLowerCase() === 'voided' ||
    order.financial_status?.toLowerCase() === 'cancelled' ||
    order.financial_status?.toLowerCase() === 'refunded' ||
    order.fulfillments?.[0]?.shipment_status === 'cancelled'
  )
}

function parseOrderIdValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/^#/, '').replace(/[^\d]/g, '')
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : null
}

function getOrderComparableId(order: ShopifyOrder): number {
  return parseOrderIdValue(order.name) ?? order.id
}

function isOrderInExportRange(order: ShopifyOrder, fromId: string, toId: string): boolean {
  const from = parseOrderIdValue(fromId)
  const to = parseOrderIdValue(toId)
  if (from === null && to === null) return true

  const orderValue = getOrderComparableId(order)
  if (from !== null && to !== null) return orderValue >= from && orderValue <= to
  if (from !== null) return orderValue >= from
  if (to !== null) return orderValue <= to
  return true
}

function getOrderDateKey(order: ShopifyOrder): string {
  return toIstDateKey(order.created_at) || ''
}

function isOrderInExportDateRange(order: ShopifyOrder, fromDate: string, toDate: string): boolean {
  if (!fromDate && !toDate) return true
  const orderDay = getOrderDateKey(order)
  if (fromDate && toDate) return orderDay >= fromDate && orderDay <= toDate
  if (fromDate) return orderDay >= fromDate
  if (toDate) return orderDay <= toDate
  return true
}

type ExportColumnKey =
  | 'order_id'
  | 'order_name'
  | 'date_created'
  | 'customer_name'
  | 'customer_phone'
  | 'customer_email'
  | 'shipping_address'
  | 'total_price'
  | 'payment_method'
  | 'financial_status'
  | 'courier_partner'
  | 'awb_tracking'
  | 'shipment_status'
  | 'source'
  | 'dispatch_date'
  | 'delivery_date'

interface ExportColumn {
  key: ExportColumnKey
  label: string
  getValue: (order: ShopifyOrder) => string
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'order_id', label: 'Order ID', getValue: (o) => String(o.id) },
  { key: 'order_name', label: 'Order Name', getValue: (o) => o.name || '' },
  { key: 'date_created', label: 'Date Created', getValue: (o) => o.created_at },
  {
    key: 'customer_name',
    label: 'Customer Name',
    getValue: (o) => (o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'Guest Customer'),
  },
  { key: 'customer_phone', label: 'Customer Phone', getValue: (o) => o.customer?.phone || o.shipping_address?.phone || '' },
  { key: 'customer_email', label: 'Customer Email', getValue: (o) => o.customer?.email || '' },
  {
    key: 'shipping_address',
    label: 'Shipping Address',
    getValue: (o) => formatShippingAddressFull(getOrderShippingAddress(o)).replace(/\n/g, ', '),
  },
  { key: 'total_price', label: 'Total Price', getValue: (o) => o.total_price || '0' },
  { key: 'payment_method', label: 'Payment Method', getValue: (o) => getPaymentLabel(o) },
  { key: 'financial_status', label: 'Financial Status', getValue: (o) => o.financial_status || '' },
  { key: 'courier_partner', label: 'Courier Partner', getValue: (o) => o.fulfillments?.[0]?.tracking_company || '' },
  { key: 'awb_tracking', label: 'AWB/Tracking Number', getValue: (o) => o.fulfillments?.[0]?.tracking_number || '' },
  { key: 'shipment_status', label: 'Shipment Status', getValue: (o) => o.fulfillments?.[0]?.shipment_status || '' },
  { key: 'source', label: 'Source', getValue: (o) => (o as any).source || 'shopify' },
  {
    key: 'dispatch_date',
    label: 'Dispatch Date',
    getValue: (o) => {
      if (o.fulfillment_status !== 'fulfilled') return ''
      const f = o.fulfillments?.[0]
      return f?.dispatch_date || f?.created_at || ''
    },
  },
  {
    key: 'delivery_date',
    label: 'Delivery Date',
    getValue: (o) => {
      const f = o.fulfillments?.[0]
      if ((f?.shipment_status || '').toLowerCase() !== 'delivered') return ''
      return f?.delivery_date || f?.created_at || ''
    },
  },
]

const ALL_EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key)

function escapeCsvCell(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

// ─── Main Component ──────────────────────────────────────────────────────────

type OrdersTab =
  | 'new'
  | 'confirmed'
  | 'ready_to_ship'
  | 'pickups_manifests'
  | 'in_transit'
  | 'delivered'
  | 'rto'
  | 'cancelled'
  | 'all'
  | 'test_orders'

export function OrdersPanel({
  lockedTab,
}: {
  lockedTab?: Extract<OrdersTab, 'confirmed'>
} = {}) {
  const router = useRouter()
  const confirmedOnly = lockedTab === 'confirmed'
  
  // Tab states
  const [currentTab, setCurrentTab] = useState<OrdersTab>(lockedTab || 'new')
  const isShipQueueTab = currentTab === 'new' || currentTab === 'confirmed'
  const [manifestSubtab, setManifestSubtab] = useState<'pickup_ids' | 'manifests'>('pickup_ids')

  // Pagination State (server-side)
  const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [ordersPerPage, setOrdersPerPage] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [totalOrders, setTotalOrders] = useState<number>(0)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [serverTabCounts, setServerTabCounts] = useState<Record<string, number>>({
    new: 0, confirmed: 0, confirmed_care: 0, confirmed_aisensy: 0, ready_to_ship: 0, pickups_manifests: 0, in_transit: 0,
    delivered: 0, rto: 0, cancelled: 0, all: 0, test_orders: 0
  })
  const [careConfirmSource, setCareConfirmSource] = useState<'care_confirmed' | 'aisensy_confirmed'>(
    'care_confirmed',
  )
  const [pageLoading, setPageLoading] = useState<boolean>(false)
  const [syncing, setSyncing] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)
  const [showExportModal, setShowExportModal] = useState<boolean>(false)
  const [exportFromOrderId, setExportFromOrderId] = useState<string>('')
  const [exportToOrderId, setExportToOrderId] = useState<string>('')
  const [exportFromDate, setExportFromDate] = useState<string>('')
  const [exportToDate, setExportToDate] = useState<string>('')
  const [selectedExportColumns, setSelectedExportColumns] = useState<ExportColumnKey[]>(ALL_EXPORT_COLUMN_KEYS)
  const syncTimeoutRef = useRef<any>(null)

  // Search & Basic Sorting States
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [showFiltersPanel, setShowFiltersPanel] = useState<boolean>(false)

  // Debounce search input — only trigger API calls after 400ms of idle typing
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // ─── CATEGORIZED ADVANCED SHIPROCKET FILTERS ───
  
  // Category A: Date Boundaries & Presets
  const [datePreset, setDatePreset] = useState<string>('30days') // today, yesterday, 7days, 30days, custom, all
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // Category B: Channel & Logistics Routing
  const [filterChannel, setFilterChannel] = useState<string>('all') // shopify, shiprocket, all
  const [filterCourier, setFilterCourier] = useState<string>('all') // delhivery, shadowfax, ekart, xpressbees, all
  const [filterPickupLocation, setFilterPickupLocation] = useState<string>('all') // primary, warehouse_b, all

  // Category C: Volumetric weight & Risk Levels
  const [filterWeightClass, setFilterWeightClass] = useState<string>('all') // under_05, 05_to_1, 1_to_2, above_2, all
  const [filterRtoRisk, setFilterRtoRisk] = useState<string>('all') // high, medium, low, all

  // Category D: Financial & Fulfillment Stages
  const [filterPaymentType, setFilterPaymentType] = useState<string>('all') // prepaid, cod, all
  const [financialFilter, setFinancialFilter] = useState<string>('all') // paid, pending, refunded, voided, all
  const [filterFulfillmentStatus, setFilterFulfillmentStatus] = useState<string>('all') // unfulfilled, scheduled, in_transit, out_for_delivery, delivered, failed, rto, all
  const [minPrice, setMinPrice] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<string>('')

  // Orders State (loaded and managed locally for high-fidelity state dispatches)
  const [orders, setOrders] = useState<ShopifyOrder[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState<boolean>(false)

  // Interactive UI elements & simulation states
  const [unmaskedPhones, setUnmaskedPhones] = useState<Record<number, boolean>>({})
  const [selectedOrders, setSelectedOrders] = useState<Record<number, boolean>>({})
  
  // Modal / Drawer Trigger States
  const [activeCourierOrder, setActiveCourierOrder] = useState<ShopifyOrder | null>(null)
  const [shipLoadingProvider, setShipLoadingProvider] = useState<'shiprocket' | 'air_express' | null>(null)
  const [shipModalStep, setShipModalStep] = useState<'provider' | 'rates'>('provider')
  const [shipSelectedProvider, setShipSelectedProvider] = useState<'shiprocket' | 'air_express' | null>(null)
  const [shipRatesLoading, setShipRatesLoading] = useState(false)
  const [shipRatesError, setShipRatesError] = useState<string | null>(null)
  const [shipCourierOptions, setShipCourierOptions] = useState<
    Array<{
      id: string
      name: string
      rate: number | null
      rateLabel?: string
      etd?: string | null
      rating?: number | null
      serviceType?: string
    }>
  >([])
  const [selectedShipOptionId, setSelectedShipOptionId] = useState<string | null>(null)
  const [activeTrackingOrder, setActiveTrackingOrder] = useState<ShopifyOrder | null>(null)
  const [activeRtoRiskOrder, setActiveRtoRiskOrder] = useState<ShopifyOrder | null>(null)
  const [activeDetailOrder, setActiveDetailOrder] = useState<ShopifyOrder | null>(null)
  const [drawerPhoneRevealed, setDrawerPhoneRevealed] = useState<boolean>(false)
  const [activeDropdownOrderId, setActiveDropdownOrderId] = useState<number | null>(null)

  const handleCloneOrder = async (order: ShopifyOrder) => {
    const cleanName = order.name || ''
    const cleanBaseName = cleanName.replace('#', '').trim()
    const clonedName = `${cleanBaseName}-C`

    const orderItems = (order.line_items || []).map(item => ({
      name: item.title || 'Starter pack',
      sku: item.sku || 'test pack',
      units: Number(item.quantity) || 1,
      selling_price: Number(item.price) || 0
    }))

    // Sanitize phone to exactly 10 digits numeric
    const rawPhone = order.customer?.phone || order.shipping_address?.phone || '9999999999'
    const sanitizedPhone = String(rawPhone).replace(/[^0-9]/g, '').slice(-10) || '9999999999'

    // Sanitize pincode to numeric
    const rawZip = order.shipping_address?.zip || '400001'
    const sanitizedZip = Number(String(rawZip).replace(/[^0-9]/g, '')) || 400001

    const payload = {
      order_id: clonedName,
      order_date: new Date().toISOString().slice(0, 10), // 'YYYY-MM-DD'
      pickup_location: 'Primary',
      billing_customer_name: order.customer?.first_name || 'Guest',
      billing_last_name: order.customer?.last_name || '',
      billing_address: order.shipping_address?.address1 || 'N/A',
      billing_address_2: order.shipping_address?.address2 || '',
      billing_city: order.shipping_address?.city || 'Mumbai',
      billing_pincode: sanitizedZip,
      billing_state: order.shipping_address?.province || 'Maharashtra',
      billing_country: order.shipping_address?.country || 'India',
      billing_email: order.customer?.email || 'customer@example.com',
      billing_phone: sanitizedPhone,
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: getPaymentLabel(order),
      sub_total: Number(order.total_price) || 0,
      length: 15,
      breadth: 10,
      height: 5,
      weight: 0.45
    }

    try {
      setActiveDropdownOrderId(null)
      triggerNotification('success', `Cloning order ${order.name} to Shiprocket panel...`)
      
      const res = await apiFetch('/api/shiprocket/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create order on Shiprocket')

      // Use the phone returned by the API (echoed back from the payload) as the definitive value
      const confirmedPhone = data.billing_phone || sanitizedPhone

      // Build the cloned order object to optimistically show it in the UI immediately.
      // Always use confirmedPhone directly — Shopify API often masks/omits phone in list responses.
      const clonedOrder: ShopifyOrder = {
        ...order,
        id: data.order_id || Math.floor(1000000 + Math.random() * 9000000),
        name: `#${clonedName}`,
        customer: {
          first_name: order.customer?.first_name || order.shipping_address?.first_name || 'Guest',
          last_name: order.customer?.last_name || order.shipping_address?.last_name || '',
          email: order.customer?.email || 'customer@example.com',
          phone: confirmedPhone,
        },
        shipping_address: order.shipping_address ? {
          ...order.shipping_address,
          phone: confirmedPhone,
        } : {
          phone: confirmedPhone
        },
        created_at: new Date().toISOString(),
        fulfillment_status: null,
        fulfillments: [],
        cancelled_at: null,
      }

      // Optimistically prepend the clone to local state and switch to All tab
      setOrders((prev) => [clonedOrder, ...prev])
      if (!confirmedOnly) setCurrentTab('all')
      setCurrentPage(1)
      triggerNotification('success', `Order cloned successfully! Showing in All Orders.`)

      // After 800ms, invalidate page cache and re-fetch page 1 from server
      setTimeout(() => {
        invalidatePageCache()
        fetchOrdersPage(1, false)
      }, 800)
    } catch (err: any) {
      triggerNotification('error', `Failed to sync clone to Shiprocket: ${err.message}`)
    }
  }
  
  // Shiprocket Actions Loading state
  const [actionLoadingOrderId, setActionLoadingOrderId] = useState<number | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [aeDocLoading, setAeDocLoading] = useState<AayshPdfType | null>(null)

  // Manifests Mock Database (starts with some, adds when dispatches are triggered)
  const [manifests, setManifests] = useState<ManifestRecord[]>([
    {
      id: 'SRPID-47954376',
      date: '18 May 2026',
      shipmentCount: 12,
      address: 'Primary Warehouse',
      courier: 'Shadowfax',
      status: 'PICKUP SCHEDULED',
      manifestName: 'Manifest-0019'
    },
    {
      id: 'SRPID-47954237',
      date: '18 May 2026',
      shipmentCount: 1,
      address: 'Primary Warehouse',
      courier: 'Delhivery',
      status: 'PICKUP SCHEDULED',
      manifestName: 'Manifest-0018'
    }
  ])

  // ── Fetch Paginated Orders ──
  const fetchPageRef = useRef<AbortController | null>(null)

  // Client-side page cache — avoids re-fetching pages already visited within the same filter context
  const PAGE_CACHE_TTL = 30_000 // 30 seconds
  interface PageCacheEntry {
    orders: ShopifyOrder[]
    pagination: { total: number; total_pages: number }
    tabCounts: Record<string, number>
    isOffline: boolean
    timestamp: number
  }
  const pageCacheRef = useRef<Map<string, PageCacheEntry>>(new Map())

  // Invalidate entire page cache (call after mutations like clone, cancel, etc.)
  const invalidatePageCache = useCallback(() => {
    pageCacheRef.current.clear()
  }, [])

  const fetchOrdersPage = useCallback(async (page: number, isInitial = false) => {
    // Abort any in-flight page request
    if (fetchPageRef.current) {
      fetchPageRef.current.abort()
    }
    const controller = new AbortController()
    fetchPageRef.current = controller

    // Clear any pending sync retry timeout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = null
    }

    // Build url search params containing page, size, tab, and advanced filters
    const queryParams = new URLSearchParams({
      page: String(page),
      per_page: String(ordersPerPage),
      tab: currentTab,
    })

    if (currentTab === 'confirmed') {
      queryParams.set('care_confirm', careConfirmSource)
    }

    if (debouncedSearchQuery) queryParams.set('search', debouncedSearchQuery)
    if (financialFilter !== 'all') queryParams.set('financial', financialFilter)
    if (filterPaymentType !== 'all') queryParams.set('payment', filterPaymentType)
    if (filterChannel !== 'all') queryParams.set('channel', filterChannel)
    if (filterCourier !== 'all') queryParams.set('courier', filterCourier)
    if (filterPickupLocation !== 'all') queryParams.set('pickup', filterPickupLocation)
    if (filterWeightClass !== 'all') queryParams.set('weight', filterWeightClass)
    if (filterRtoRisk !== 'all') queryParams.set('rto', filterRtoRisk)
    if (minPrice) queryParams.set('min_price', minPrice)
    if (maxPrice) queryParams.set('max_price', maxPrice)
    if (datePreset !== 'all') queryParams.set('date_preset', datePreset)
    if (startDate) queryParams.set('start_date', startDate)
    if (endDate) queryParams.set('end_date', endDate)
    if (filterFulfillmentStatus !== 'all') queryParams.set('fulfillment', filterFulfillmentStatus)

    const cacheKey = queryParams.toString()

    // Check client-side page cache first (not for initial load or sync retries)
    if (!isInitial) {
      const cached = pageCacheRef.current.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < PAGE_CACHE_TTL) {
        setOrders(cached.orders)
        setIsOffline(cached.isOffline)
        setTotalOrders(cached.pagination.total)
        setTotalPages(cached.pagination.total_pages)
        setServerTabCounts(cached.tabCounts)
        setError(null)
        setPageLoading(false)
        return
      }
    }

    try {
      if (isInitial) setLoading(true)
      else setPageLoading(true)

      const res = await apiFetch(`/api/shopify/orders?${cacheKey}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch Shopify orders')

      if (data.syncing) {
        setSyncing(true)
        setError(null)
        // Keep loading indicators true and reschedule fetch in 2s
        syncTimeoutRef.current = setTimeout(() => {
          fetchOrdersPage(page, isInitial)
        }, 2000)
        return
      }

      setSyncing(false)

      const enriched: ShopifyOrder[] = (data.orders || []).map((o: any) => ({
        ...o,
        fulfillment_status: o.fulfillment_status || null,
        fulfillments: o.fulfillments || []
      }))

      setOrders(enriched)
      setIsOffline(!!data.isOffline)
      setError(null)

      // Store server pagination metadata
      if (data.pagination) {
        setTotalOrders(data.pagination.total)
        setTotalPages(data.pagination.total_pages)
      }

      // Store server-computed tab counts
      if (data.tabCounts) {
        setServerTabCounts(data.tabCounts)
      }

      // Store in client-side page cache
      pageCacheRef.current.set(cacheKey, {
        orders: enriched,
        pagination: { total: data.pagination?.total || 0, total_pages: data.pagination?.total_pages || 1 },
        tabCounts: data.tabCounts || {},
        isOffline: !!data.isOffline,
        timestamp: Date.now(),
      })
    } catch (err: any) {
      if (err.name === 'AbortError') return // Ignore aborted requests
      setError(err.message)
      setSyncing(false)
    } finally {
      if (!syncTimeoutRef.current) {
        setLoading(false)
        setPageLoading(false)
      }
    }
  }, [
    ordersPerPage,
    currentTab,
    careConfirmSource,
    debouncedSearchQuery,
    financialFilter,
    filterPaymentType,
    filterChannel,
    filterCourier,
    filterPickupLocation,
    filterWeightClass,
    filterRtoRisk,
    minPrice,
    maxPrice,
    datePreset,
    startDate,
    endDate,
    filterFulfillmentStatus,
  ])

  // Initial load
  useEffect(() => {
    fetchOrdersPage(1, true)
  }, [])

  // Refetch when page changes (not on initial mount)
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    fetchOrdersPage(currentPage)
  }, [currentPage, fetchOrdersPage])

  // Reset currentPage to 1 when filters, tab, page size, or debounced search change
  useEffect(() => {
    setCurrentPage(1)
  }, [
    currentTab,
    careConfirmSource,
    debouncedSearchQuery,
    financialFilter,
    filterPaymentType,
    filterChannel,
    filterCourier,
    filterPickupLocation,
    filterWeightClass,
    filterRtoRisk,
    minPrice,
    maxPrice,
    datePreset,
    startDate,
    endDate,
    filterFulfillmentStatus,
    sortOrder,
    ordersPerPage,
  ])

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [])

  // ─── Live Event Listeners for Incoming Shopify Orders ───
  useEffect(() => {
    const handleLiveOrderReceived = (e: Event) => {
      const customEvent = e as CustomEvent<ShopifyOrder>
      const newOrder = customEvent.detail
      if (newOrder && newOrder.id) {
        setOrders((prev) => {
          if (prev.some(o => o.id === newOrder.id || o.name === newOrder.name)) return prev
          return [newOrder, ...prev]
        })
        invalidatePageCache()
        fetchOrdersPage(1, false)
      }
    }

    const handleViewLiveOrder = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      const orderName = customEvent.detail
      if (orderName) {
        // 1. Close any open detail drawers/modals first
        setActiveDetailOrder(null)
        setActiveCourierOrder(null)
        setActiveTrackingOrder(null)
        setActiveRtoRiskOrder(null)

        // 2. Switch tab to 'new' (since the simulated order is unfulfilled/new)
        if (!confirmedOnly) setCurrentTab('new')

        // 3. Highlight/Open details drawer for the matching order
        setTimeout(() => {
          setOrders((currentOrders) => {
            const found = currentOrders.find((o) => o.name === orderName)
            if (found) {
              setActiveDetailOrder(found)
            }
            return currentOrders
          })
        }, 100)
      }
    }

    window.addEventListener('shopify_new_order_received', handleLiveOrderReceived)
    window.addEventListener('shopify_view_live_order', handleViewLiveOrder)

    return () => {
      window.removeEventListener('shopify_new_order_received', handleLiveOrderReceived)
      window.removeEventListener('shopify_view_live_order', handleViewLiveOrder)
    }
  }, [invalidatePageCache, fetchOrdersPage])



  // ── Logistics Actions ──

  const resetShipModal = () => {
    setActiveCourierOrder(null)
    setShipModalStep('provider')
    setShipSelectedProvider(null)
    setShipRatesLoading(false)
    setShipRatesError(null)
    setShipCourierOptions([])
    setSelectedShipOptionId(null)
    setShipLoadingProvider(null)
  }

  const openShipRates = async (provider: 'shiprocket' | 'air_express', order: ShopifyOrder) => {
    setShipSelectedProvider(provider)
    setShipModalStep('rates')
    setShipRatesLoading(true)
    setShipRatesError(null)
    setShipCourierOptions([])
    setSelectedShipOptionId(null)

    try {
      const path =
        provider === 'shiprocket'
          ? `/api/shiprocket/courier-serviceability?orderId=${encodeURIComponent(String(order.id))}`
          : `/api/air-express/courier-options?orderId=${encodeURIComponent(String(order.id))}`
      const res = await apiFetch(path)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed to load rates (${res.status})`)

      if (provider === 'shiprocket') {
        const list = (data.couriers || []).map((c: any) => ({
          id: String(c.courierCompanyId ?? c.id),
          name: String(c.name || 'Courier'),
          rate: c.rate != null ? Number(c.rate) : null,
          etd: c.etd || null,
          rating: c.rating != null ? Number(c.rating) : null,
        }))
        setShipCourierOptions(list)
        if (list[0]) setSelectedShipOptionId(list[0].id)
      } else {
        const list = (data.services || []).map((s: any) => ({
          id: String(s.id || s.serviceType),
          name: String(s.name || s.serviceType),
          rate: s.rate != null ? Number(s.rate) : null,
          rateLabel: s.rateLabel || 'As per contract',
          etd: s.etd || null,
          serviceType: String(s.serviceType || s.id),
        }))
        setShipCourierOptions(list)
        if (list[0]) setSelectedShipOptionId(list[0].id)
      }
    } catch (err: any) {
      setShipRatesError(err?.message || 'Failed to load delivery partners')
    } finally {
      setShipRatesLoading(false)
    }
  }

  // 1. Ship Now — Shiprocket with selected courier
  const handleAssignCourier = async (orderId: number, courierId?: string | null) => {
    try {
      setActionLoadingOrderId(orderId)
      setShipLoadingProvider('shiprocket')
      const res = await apiFetch('/api/shiprocket/ship-confirmed-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, courierId: courierId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Ship failed (${res.status})`)
      }

      if (data.order) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? ({ ...o, ...data.order } as ShopifyOrder) : o)),
        )
      }

      resetShipModal()
      setSelectedOrders({})
      invalidatePageCache()
      if (!confirmedOnly) setCurrentTab('ready_to_ship')

      const awb = data.awb ? String(data.awb) : ''
      const courierName = data.courier ? String(data.courier) : 'Shiprocket'
      if (awb) {
        triggerNotification(
          'success',
          `Shipped ${data.orderName || ''} · AWB ${awb} (${courierName})`,
        )
      } else if (data.warning) {
        triggerNotification('error', String(data.warning))
      } else {
        triggerNotification(
          'success',
          `Order ${data.orderName || ''} pushed to Shiprocket. Refresh if AWB is still pending.`,
        )
      }

      try {
        await fetchOrdersPage(currentPage)
      } catch {
        // local patch already applied
      }
    } catch (err: any) {
      triggerNotification('error', err?.message || 'Failed to ship on Shiprocket')
    } finally {
      setActionLoadingOrderId(null)
      setShipLoadingProvider(null)
    }
  }

  const handleShipViaAirExpress = async (orderId: number, serviceType?: string | null) => {
    try {
      setActionLoadingOrderId(orderId)
      setShipLoadingProvider('air_express')
      const res = await apiFetch('/api/air-express/ship-confirmed-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          serviceType: serviceType || 'surface',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Air Express ship failed (${res.status})`)
      }

      if (data.order) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? ({ ...o, ...data.order } as ShopifyOrder) : o)),
        )
      }

      resetShipModal()
      setSelectedOrders({})
      invalidatePageCache()
      if (!confirmedOnly) setCurrentTab('ready_to_ship')

      const awb = data.awb ? String(data.awb) : ''
      const courierName = data.courier ? String(data.courier) : 'Air Express'
      if (awb) {
        triggerNotification(
          'success',
          `Shipped ${data.orderName || ''} via Air Express · AWB ${awb} (${courierName})`,
        )
      } else if (data.warning) {
        triggerNotification('error', String(data.warning))
      } else {
        triggerNotification(
          'success',
          `Order ${data.orderName || ''} pushed to Air Express. Refresh if AWB is still pending.`,
        )
      }

      try {
        await fetchOrdersPage(currentPage)
      } catch {
        // local patch already applied
      }
    } catch (err: any) {
      triggerNotification('error', err?.message || 'Failed to ship on Air Express')
    } finally {
      setActionLoadingOrderId(null)
      setShipLoadingProvider(null)
    }
  }

  const handleConfirmSelectedShip = () => {
    if (!activeCourierOrder || !shipSelectedProvider || !selectedShipOptionId) return
    const option = shipCourierOptions.find((o) => o.id === selectedShipOptionId)
    if (shipSelectedProvider === 'shiprocket') {
      void handleAssignCourier(activeCourierOrder.id, selectedShipOptionId)
    } else {
      void handleShipViaAirExpress(
        activeCourierOrder.id,
        option?.serviceType || selectedShipOptionId,
      )
    }
  }

  const handleAirExpressDocuments = async (
    type: AayshPdfType,
    orders: ShopifyOrder[],
  ) => {
    const aeOrders = orders.filter(isAeShippedOrder)
    if (!aeOrders.length) {
      triggerNotification('error', 'No Air Express orders selected to print')
      return
    }
    try {
      setAeDocLoading(type)
      const { url, filename } = await downloadAirExpressDocument(
        type,
        [],
        aeOrders.map((o) => o.id),
      )
      if (url) openAirExpressPdf(url, filename || `aaysh-${type}.pdf`)
      const label = type === 'labels' ? 'label' : type === 'manifests' ? 'manifest' : 'invoice'
      triggerNotification(
        'success',
        `Air Express ${label} generated for ${aeOrders.length} order${aeOrders.length === 1 ? '' : 's'}`,
      )
    } catch (err: any) {
      triggerNotification('error', err?.message || `Failed to generate Air Express ${type}`)
    } finally {
      setAeDocLoading(null)
    }
  }

  // 2. Download Manifest (Air Express prints the real PDF; others keep the dispatch mock)
  const handleManifestDispatch = (order: ShopifyOrder) => {
    if (isAeShippedOrder(order)) {
      void handleAirExpressDocuments('manifests', [order])
      return
    }
    setActionLoadingOrderId(order.id)
    setTimeout(() => {
      // Move to In Transit
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== order.id) return o
          const currentFulfillments = o.fulfillments || []
          return {
            ...o,
            fulfillments: currentFulfillments.map((f, i) =>
              i === 0 ? { ...f, shipment_status: 'in_transit' } : f
            )
          }
        })
      )
      // Add manifest record
      const newManifest: ManifestRecord = {
        id: `SRPID-${Math.floor(47000000 + Math.random() * 900000)}`,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        shipmentCount: 1,
        address: 'Primary Warehouse',
        courier: order.fulfillments?.[0]?.tracking_company || 'Standard Surface',
        status: 'PICKUP SCHEDULED',
        manifestName: `Manifest-00${Math.floor(20 + Math.random() * 80)}`
      }
      setManifests((prev) => [newManifest, ...prev])
      setActionLoadingOrderId(null)
      triggerNotification('success', `Manifest fully generated and printed! Package is hand-off ready.`)
    }, 1000)
  }

  // Helper notification bubble
  const triggerNotification = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text })
    setTimeout(() => setActionMessage(null), 5000)
  }

  // ── Toggle Test Order ──
  const [togglingTestOrderId, setTogglingTestOrderId] = useState<number | null>(null)

  const handleToggleTestOrder = async (order: ShopifyOrder) => {
    const isTest = !(order as any).is_test_order
    const message = isTest
      ? `Are you sure you want to mark order ${order.name} as a TEST order? This will move it to the Test Orders tab and exclude it from all sales analytics and reports.`
      : `Are you sure you want to remove the test status from order ${order.name}? This will move it back to real orders and include its metrics in all sales analytics.`

    if (!window.confirm(message)) return

    try {
      setTogglingTestOrderId(order.id)
      const res = await apiFetch(`/api/shopify/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_test_order: isTest })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to toggle test status')

      // Update in local state
      setOrders((prev) => prev.map((o) => {
        if (o.id === order.id) {
          return {
            ...o,
            is_test_order: isTest
          }
        }
        return o
      }))

      // Update drawer if currently open
      if (activeDetailOrder && activeDetailOrder.id === order.id) {
        setActiveDetailOrder((prev) => prev ? { ...prev, is_test_order: isTest } : null)
      }

      invalidatePageCache()
      triggerNotification('success', isTest ? 'Order marked as test order successfully.' : 'Test order status removed successfully.')
    } catch (err: any) {
      triggerNotification('error', err.message || 'Error toggling test status.')
    } finally {
      setTogglingTestOrderId(null)
    }
  }

  // ── Cancel Order ──
  const [deletingOrderId, setDeletingOrderId] = useState<number | null>(null)

  const handleDeleteOrder = async (orderId: number) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return

    try {
      setDeletingOrderId(orderId)
      const res = await apiFetch(`/api/shopify/orders/${orderId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to cancel order')

      // Update order state in-place to cancelled
      setOrders((prev) => prev.map((o) => {
        if (o.id === orderId) {
          return {
            ...o,
            cancelled_at: new Date().toISOString(),
            financial_status: 'voided'
          }
        }
        return o
      }))
      setActiveDetailOrder(null)
      invalidatePageCache()
      triggerNotification('success', 'Order cancelled successfully.')
    } catch (err: any) {
      triggerNotification('error', err.message || 'Error cancelling order.')
    } finally {
      setDeletingOrderId(null)
    }
  }

  const [bulkDeleting, setBulkDeleting] = useState(false)

  const handleBulkDelete = async () => {
    const selectedIds = Object.keys(selectedOrders)
      .map(Number)
      .filter((id) => selectedOrders[id])

    if (selectedIds.length === 0) return

    if (!window.confirm(`Are you sure you want to cancel the ${selectedIds.length} selected orders?`)) return

    try {
      setBulkDeleting(true)
      const res = await apiFetch('/api/shopify/orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to bulk cancel orders')

      // Mark selected orders as cancelled in state
      setOrders((prev) => prev.map((o) => {
        if (selectedIds.includes(o.id)) {
          return {
            ...o,
            cancelled_at: new Date().toISOString(),
            financial_status: 'voided'
          }
        }
        return o
      }))
      setSelectedOrders({})
      invalidatePageCache()
      triggerNotification('success', `Successfully cancelled ${selectedIds.length} orders.`)
    } catch (err: any) {
      triggerNotification('error', err.message || 'Error bulk cancelling orders.')
    } finally {
      setBulkDeleting(false)
    }
  }

  const [bulkTestToggling, setBulkTestToggling] = useState(false)

  const handleBulkToggleTest = async (isTest: boolean) => {
    const selectedIds = Object.keys(selectedOrders)
      .map(Number)
      .filter((id) => selectedOrders[id])

    if (selectedIds.length === 0) return

    const message = isTest
      ? `Are you sure you want to mark the ${selectedIds.length} selected orders as TEST orders?`
      : `Are you sure you want to remove test status from the ${selectedIds.length} selected orders?`

    if (!window.confirm(message)) return

    try {
      setBulkTestToggling(true)
      const results = await Promise.allSettled(
        selectedIds.map(async (id) => {
          const res = await apiFetch(`/api/shopify/orders/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_test_order: isTest }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || `Failed for order ${id}`)
          }
          return id
        })
      )

      const successfulIds = results
        .filter((r) => r.status === 'fulfilled')
        .map((r: any) => Number(r.value))

      setOrders((prev) =>
        prev.map((o) => {
          if (successfulIds.includes(Number(o.id))) {
            return {
              ...o,
              is_test_order: isTest,
            }
          }
          return o
        })
      )

      setSelectedOrders({})
      invalidatePageCache()
      triggerNotification(
        'success',
        `Successfully updated test status for ${successfulIds.length} orders.`
      )
    } catch (err: any) {
      triggerNotification('error', err.message || 'Error bulk updating test status.')
    } finally {
      setBulkTestToggling(false)
    }
  }

  // ── Export to Google Sheets ──
  const handleExportToSheets = async (
    fromOrderId = exportFromOrderId,
    toOrderId = exportToOrderId,
    fromDate = exportFromDate,
    toDate = exportToDate,
  ) => {
    const trimmedFrom = fromOrderId.trim()
    const trimmedTo = toOrderId.trim()
    const trimmedFromDate = fromDate.trim()
    const trimmedToDate = toDate.trim()

    const hasOrderIdRange = Boolean(trimmedFrom || trimmedTo)
    const hasDateRange = Boolean(trimmedFromDate || trimmedToDate)

    if (!hasOrderIdRange && !hasDateRange) {
      triggerNotification('error', 'Please enter an Order ID range and/or a date range.')
      return
    }

    if (hasOrderIdRange && (!trimmedFrom || !trimmedTo)) {
      triggerNotification('error', 'Please enter both From and To Order IDs.')
      return
    }

    if (hasDateRange && (!trimmedFromDate || !trimmedToDate)) {
      triggerNotification('error', 'Please enter both From Date and Till Date.')
      return
    }

    const fromNum = parseOrderIdValue(trimmedFrom)
    const toNum = parseOrderIdValue(trimmedTo)

    if (trimmedFrom && fromNum === null) {
      triggerNotification('error', 'Invalid From Order ID. Use values like R_1650 or 1650.')
      return
    }
    if (trimmedTo && toNum === null) {
      triggerNotification('error', 'Invalid To Order ID. Use values like R_1670 or 1670.')
      return
    }
    if (fromNum !== null && toNum !== null && fromNum > toNum) {
      triggerNotification('error', 'From Order ID cannot be greater than To Order ID.')
      return
    }
    if (trimmedFromDate && trimmedToDate && trimmedFromDate > trimmedToDate) {
      triggerNotification('error', 'From Date cannot be after Till Date.')
      return
    }

    if (selectedExportColumns.length === 0) {
      triggerNotification('error', 'Please select at least one column to export.')
      return
    }

    const columnsToExport = EXPORT_COLUMNS.filter((col) => selectedExportColumns.includes(col.key))

    try {
      setExporting(true)
      setShowExportModal(false)
      
      const queryParams = new URLSearchParams({
        tab: currentTab,
        all: 'true'
      })

      if (debouncedSearchQuery) queryParams.set('search', debouncedSearchQuery)
      if (financialFilter !== 'all') queryParams.set('financial', financialFilter)
      if (filterPaymentType !== 'all') queryParams.set('payment', filterPaymentType)
      if (filterChannel !== 'all') queryParams.set('channel', filterChannel)
      if (filterCourier !== 'all') queryParams.set('courier', filterCourier)
      if (filterPickupLocation !== 'all') queryParams.set('pickup', filterPickupLocation)
      if (filterWeightClass !== 'all') queryParams.set('weight', filterWeightClass)
      if (filterRtoRisk !== 'all') queryParams.set('rto', filterRtoRisk)
      if (minPrice) queryParams.set('min_price', minPrice)
      if (maxPrice) queryParams.set('max_price', maxPrice)
      if (hasDateRange) {
        queryParams.set('start_date', trimmedFromDate)
        queryParams.set('end_date', trimmedToDate)
      } else {
        if (datePreset !== 'all') queryParams.set('date_preset', datePreset)
        if (startDate) queryParams.set('start_date', startDate)
        if (endDate) queryParams.set('end_date', endDate)
      }
      if (filterFulfillmentStatus !== 'all') queryParams.set('fulfillment', filterFulfillmentStatus)

      const res = await apiFetch(`/api/shopify/orders?${queryParams.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to export orders')

      const allOrders: ShopifyOrder[] = data.orders || []
      const exportList = allOrders.filter(
        (o) =>
          isOrderInExportRange(o, trimmedFrom, trimmedTo) &&
          isOrderInExportDateRange(o, trimmedFromDate, trimmedToDate)
      )

      if (allOrders.length === 0) {
        triggerNotification('error', 'No orders found to export.')
        setExporting(false)
        return
      }
      if (exportList.length === 0) {
        triggerNotification('error', 'No orders found in the selected range.')
        setExporting(false)
        return
      }

      const headers = columnsToExport.map((col) => col.label)

      const rows = exportList.map((o) =>
        columnsToExport.map((col) => escapeCsvCell(col.getValue(o))).join(',')
      )

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      
      const timestamp = new Date().toISOString().slice(0, 10)
      const rangeSuffix = [
        trimmedFrom || trimmedTo ? `${trimmedFrom || 'start'}_to_${trimmedTo || 'end'}` : '',
        trimmedFromDate || trimmedToDate ? `${trimmedFromDate || 'start'}_to_${trimmedToDate || 'end'}` : '',
      ].filter(Boolean).join('_')
      link.setAttribute('href', url)
      link.setAttribute('download', `orders_export_${currentTab}${rangeSuffix ? `_${rangeSuffix}` : ''}_${timestamp}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      triggerNotification('success', `Exported ${exportList.length} orders successfully!`)
    } catch (err: any) {
      triggerNotification('error', err.message || 'Error exporting orders.')
    } finally {
      setExporting(false)
    }
  }

  // ── Phone Masking Toggler ──
  const togglePhoneMask = (id: number) => {
    setUnmaskedPhones((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // ── Row Selection Toggler ──
  const toggleSelectRow = (id: number) => {
    setSelectedOrders((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleSelectAll = (filteredList: ShopifyOrder[]) => {
    const allSelected = filteredList.every((o) => selectedOrders[o.id])
    const updated: Record<number, boolean> = { ...selectedOrders }
    filteredList.forEach((o) => {
      updated[o.id] = !allSelected
    })
    setSelectedOrders(updated)
  }

  // ── RTO Risk Assessment Engine ──
  const getRtoRisk = (order: ShopifyOrder) => {
    const price = parseFloat(order.total_price)
    const isCod = isCodOrder(order)
    if (isCod && price > 1000) {
      return { score: 'High Risk', pct: '68% Risk Score', color: 'red' as const, factors: ['COD Payment Method', 'High Value Ticket Item', 'Pincode delivery failure rate: 12.4%'] }
    }
    if (isCod) {
      return { score: 'Medium Risk', pct: '34% Risk Score', color: 'yellow' as const, factors: ['COD Payment Method', 'Pincode delivery failure rate: 4.8%'] }
    }
    return { score: 'Low Risk', pct: '2.5% Risk Score', color: 'green' as const, factors: ['Prepaid Order Secured', 'Address match score: 98%', 'Previous buyer history verified'] }
  }

  // ── Filters & Search Bounding Core ──
  const activeFiltersCount = [
    financialFilter !== 'all',
    filterPaymentType !== 'all',
    filterChannel !== 'all',
    filterCourier !== 'all',
    filterPickupLocation !== 'all',
    filterWeightClass !== 'all',
    filterRtoRisk !== 'all',
    minPrice !== '',
    maxPrice !== '',
    datePreset !== '30days' && datePreset !== 'all',
    datePreset === 'custom' || datePreset === 'all'
      ? Boolean(startDate || endDate)
      : false,
    filterFulfillmentStatus !== 'all',
  ].filter(Boolean).length

  // All filtering is handled server-side by getCachedOrdersFiltered().
  // Client-side only needs to apply sort order (which is not sent to the API).
  const paginatedOrders = [...orders].sort((a, b) => {
    const dateA = new Date(a.created_at).getTime()
    const dateB = new Date(b.created_at).getTime()
    return sortOrder === 'desc' ? dateB - dateA : dateA - dateB
  })

  // Server-driven pagination metadata
  const startIndex = (currentPage - 1) * ordersPerPage
  const endIndex = startIndex + ordersPerPage

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
      <Sidebar />
      <TopBar />
      
      <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto mt-20">
          
          {/* Action toast feedback */}
          {actionMessage && (
            <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl animate-fade-in ${
              actionMessage.type === 'success'
                ? 'bg-green-950/90 border-green-500/50 text-green-300'
                : 'bg-red-950/90 border-red-500/50 text-red-300'
            }`}>
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              <span className="text-sm font-medium">{actionMessage.text}</span>
              <button onClick={() => setActionMessage(null)} className="hover:opacity-75">
                <X className="w-4 h-4 ml-1" />
              </button>
            </div>
          )}

          {/* Page Title & Top Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="px-2.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-semibold">
                  {confirmedOnly ? 'Care confirmed · ready to ship' : 'Shiprocket Logistics Core'}
                </div>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight heading-gradient">
                {confirmedOnly ? 'Confirmed Orders' : 'Shiprocket Order Panel'}
              </h1>
            </div>

            {/* Quick stats banner */}
            <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 pr-6 backdrop-blur-md">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center border border-purple-500/20 shrink-0 text-purple-300">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide">Sync Status</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${isOffline ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-ping'}`}></span>
                  <span className="text-sm font-bold text-white">
                    {isOffline ? 'Offline / Demo' : 'Live Connection'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {isOffline && (
            <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-400" />
              <span>🔌 <strong>Offline / Demo Mode:</strong> External Shopify & Shiprocket endpoints are currently unreachable (getaddrinfo ENOTFOUND). Showing realistic simulated data for dashboard evaluation.</span>
            </div>
          )}

          {error && !isOffline && (
            <div className="mb-6 p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Failed to fetch real-time logs: {error}</span>
            </div>
          )}

          {/* Search, Sort, Filter Drawer Toggle */}
          <div className="bg-card rounded-2xl border border-white/10 p-4 mb-6 backdrop-blur-xl">
            <div className="flex flex-col md:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Search via Order Name, ID, SKU, or Customer details..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/35 focus:outline-none focus:border-purple-500/50 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                <button
                  onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Sorted: {sortOrder === 'desc' ? 'Latest First' : 'Oldest First'}
                </button>

                <button
                  onClick={() => setShowExportModal(true)}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  {exporting ? 'Exporting...' : 'Export to Sheets'}
                </button>

                <button
                  onClick={() => setShowFiltersPanel(!showFiltersPanel)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    showFiltersPanel || activeFiltersCount > 0
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/80'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Advanced Filters
                  {activeFiltersCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-white text-purple-700 text-[10px] font-bold flex items-center justify-center ml-0.5">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* ── HIGH FIDELITY CATEGORIZED SHIPROCKET FILTER PANEL ── */}
            {showFiltersPanel && (
              <div className="mt-4 pt-4 border-t border-white/10 animate-slide-down">
                <div className="flex items-center gap-2 mb-4">
                  <Filter className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-300">Category Filters (Official Shiprocket Specs)</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-md">
                  
                  {/* Category A: Date Boundaries & Presets */}
                  <div className="space-y-4 border-r border-white/5 pr-4 last:border-0 last:pr-0">
                    <p className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">A. Date Presets & Ranges</p>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Date Presets</label>
                      <select
                        value={datePreset}
                        onChange={(e) => setDatePreset(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Dates</option>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7days">Last 7 Days</option>
                        <option value="30days">Last 30 Days</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-white/40 font-semibold uppercase">Custom Start</label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => { setStartDate(e.target.value); setDatePreset('all'); }}
                          className="w-full px-2 py-1 bg-[#0e121a] border border-white/10 rounded-lg text-[10px] text-white/80 focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-white/40 font-semibold uppercase">Custom End</label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => { setEndDate(e.target.value); setDatePreset('all'); }}
                          className="w-full px-2 py-1 bg-[#0e121a] border border-white/10 rounded-lg text-[10px] text-white/80 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Category B: Channel & Logistics Routing */}
                  <div className="space-y-4 border-r border-white/5 pr-4 last:border-0 last:pr-0">
                    <p className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">B. Channel & Logistics</p>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Sales Channel</label>
                      <select
                        value={filterChannel}
                        onChange={(e) => setFilterChannel(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Channels</option>
                        <option value="shopify">Shopify</option>
                        <option value="shiprocket">Shiprocket only</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Courier Partner</label>
                      <select
                        value={filterCourier}
                        onChange={(e) => setFilterCourier(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Couriers</option>
                        <option value="delhivery">Delhivery</option>
                        <option value="shadowfax">Shadowfax</option>
                        <option value="ekart">Ekart Logistics</option>
                        <option value="xpressbees">Xpressbees</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Pickup Warehouse</label>
                      <select
                        value={filterPickupLocation}
                        onChange={(e) => setFilterPickupLocation(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Warehouses</option>
                        <option value="primary">Primary Hub (Delhi)</option>
                        <option value="warehouse_b">Warehouse B (Mumbai)</option>
                      </select>
                    </div>
                  </div>

                  {/* Category C: Weight Dimensions & Risk Probability */}
                  <div className="space-y-4 border-r border-white/5 pr-4 last:border-0 last:pr-0">
                    <p className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">C. Volumetric & RTO Risk</p>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Package Weight Class</label>
                      <select
                        value={filterWeightClass}
                        onChange={(e) => setFilterWeightClass(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Weights</option>
                        <option value="under_05">Under 0.5 Kg</option>
                        <option value="05_to_1">0.5 Kg to 1.0 Kg</option>
                        <option value="1_to_2">1.0 Kg to 2.0 Kg</option>
                        <option value="above_2">Above 2.0 Kg</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">RTO Risk Probability</label>
                      <select
                        value={filterRtoRisk}
                        onChange={(e) => setFilterRtoRisk(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Risk Levels</option>
                        <option value="high">High Risk Score</option>
                        <option value="medium">Medium Risk Score</option>
                        <option value="low">Low Risk Score</option>
                      </select>
                    </div>
                  </div>

                  {/* Category D: Financial & Fulfillment Stages */}
                  <div className="space-y-4">
                    <p className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">D. Financials & Delivery</p>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-white/40 font-semibold uppercase">Payment Type</label>
                        <select
                          value={filterPaymentType}
                          onChange={(e) => setFilterPaymentType(e.target.value)}
                          className="w-full px-2 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-[10px] text-white focus:outline-none"
                        >
                          <option value="all">All Types</option>
                          <option value="prepaid">Prepaid</option>
                          <option value="cod">COD</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-white/40 font-semibold uppercase">Financials</label>
                        <select
                          value={financialFilter}
                          onChange={(e) => setFinancialFilter(e.target.value)}
                          className="w-full px-2 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-[10px] text-white focus:outline-none"
                        >
                          <option value="all">All</option>
                          <option value="paid">Paid</option>
                          <option value="pending">Pending</option>
                          <option value="refunded">Refunded</option>
                          <option value="voided">Voided</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Fulfillment Sub-Status</label>
                      <select
                        value={filterFulfillmentStatus}
                        onChange={(e) => setFilterFulfillmentStatus(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                      >
                        <option value="all">All Stages</option>
                        <option value="unfulfilled">Unfulfilled</option>
                        <option value="label printed">Label Printed</option>
                        <option value="pickup scheduled">Pickup Scheduled</option>
                        <option value="in transit">In Transit</option>
                        <option value="out for delivery">Out for Delivery</option>
                        <option value="delivered">Delivered</option>
                        <option value="delivery failed">Failed Attempts</option>
                        <option value="rto">RTO Returns</option>
                      </select>
                    </div>

                    {/* Price boundaries */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/40 font-semibold uppercase">Order Value (INR)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white placeholder-white/20 focus:outline-none"
                        />
                        <span className="text-white/30 text-xs">-</span>
                        <input
                          type="number"
                          placeholder="Max"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#0e121a] border border-white/10 rounded-lg text-xs text-white placeholder-white/20 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Drawer Footer Actions */}
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-white/5 text-xs font-semibold">
                  <span className="text-white/40">
                    {activeFiltersCount > 0
                      ? `Active criteria: ${activeFiltersCount} applied · Resolving ${totalOrders} matching shipments`
                      : 'All Shiprocket filter categories are currently in neutral state.'}
                  </span>
                  <div className="flex gap-2">
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={() => {
                          setDatePreset('30days')
                          setStartDate('')
                          setEndDate('')
                          setFilterChannel('all')
                          setFilterCourier('all')
                          setFilterPickupLocation('all')
                          setFilterWeightClass('all')
                          setFilterRtoRisk('all')
                          setFilterPaymentType('all')
                          setFinancialFilter('all')
                          setFilterFulfillmentStatus('all')
                          setMinPrice('')
                          setMaxPrice('')
                        }}
                        className="px-4 py-2 rounded-xl border border-white/10 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        Reset Shiprocket Filters
                      </button>
                    )}
                    <button
                      onClick={() => setShowFiltersPanel(false)}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-colors"
                    >
                      Apply & Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Shiprocket Tabs Navigation Bar ── */}
          {!confirmedOnly && (
          <div className="border-b border-white/10 mb-6 flex overflow-x-auto scrollbar-none gap-2">
            {(['new', 'confirmed', 'ready_to_ship', 'pickups_manifests', 'in_transit', 'delivered', 'rto', 'cancelled', 'all', 'test_orders'] as const).map((tab) => {
              const isActive = currentTab === tab
              const count = tab === 'pickups_manifests' ? manifests.length : (serverTabCounts[tab] ?? 0)
              const tabLabels = {
                new: 'New',
                confirmed: 'Confirmed',
                ready_to_ship: 'Ready To Ship',
                pickups_manifests: 'Pickups & Manifests',
                in_transit: 'In Transit',
                delivered: 'Delivered',
                rto: 'RTO',
                cancelled: 'Cancelled',
                all: 'All',
                test_orders: 'Test Orders'
              }

              return (
                <button
                  key={tab}
                  onClick={() => setCurrentTab(tab)}
                  className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-all border-b-2 -mb-px flex items-center gap-2 ${
                    isActive
                      ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                      : 'border-transparent text-white/60 hover:text-white'
                  }`}
                >
                  {tabLabels[tab]}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isActive
                      ? 'bg-purple-500 text-white'
                      : 'bg-white/10 text-white/80'
                  }`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          )}
          {confirmedOnly && (
            <div className="border-b border-white/10 mb-6 pb-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-300">Confirmed queue</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500 text-white">
                    {careConfirmSource === 'care_confirmed'
                      ? (serverTabCounts.confirmed_care ?? totalOrders)
                      : (serverTabCounts.confirmed_aisensy ?? totalOrders)}
                  </span>
                  <span className="text-[10px] text-white/40">
                    of {serverTabCounts.confirmed ?? '—'} total confirmed
                  </span>
                </div>
                <p className="text-xs text-white/50">
                  Same actions as Orders · Ship Now assigns courier on the original order
                </p>
              </div>
              <div className="flex gap-2 bg-white/5 border border-white/10 p-1.5 rounded-xl w-full sm:w-auto sm:max-w-xl">
                <button
                  type="button"
                  onClick={() => setCareConfirmSource('care_confirmed')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    careConfirmSource === 'care_confirmed'
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Customer Care confirmed
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums ${
                      careConfirmSource === 'care_confirmed' ? 'bg-white/20' : 'bg-white/10'
                    }`}
                  >
                    {serverTabCounts.confirmed_care ?? 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setCareConfirmSource('aisensy_confirmed')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    careConfirmSource === 'aisensy_confirmed'
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  AiSensy confirmed
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums ${
                      careConfirmSource === 'aisensy_confirmed' ? 'bg-white/20' : 'bg-white/10'
                    }`}
                  >
                    {serverTabCounts.confirmed_aisensy ?? 0}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Also show source switcher when Confirmed tab is open inside Orders */}
          {!confirmedOnly && currentTab === 'confirmed' && (
            <div className="flex gap-2 bg-white/5 border border-white/10 p-1.5 rounded-xl mb-4 w-full sm:max-w-xl">
              <button
                type="button"
                onClick={() => setCareConfirmSource('care_confirmed')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  careConfirmSource === 'care_confirmed'
                    ? 'bg-emerald-600 text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Customer Care
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/15 tabular-nums">
                  {serverTabCounts.confirmed_care ?? 0}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCareConfirmSource('aisensy_confirmed')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  careConfirmSource === 'aisensy_confirmed'
                    ? 'bg-violet-600 text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                AiSensy
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/15 tabular-nums">
                  {serverTabCounts.confirmed_aisensy ?? 0}
                </span>
              </button>
            </div>
          )}

          {/* ── Sub-tabs under Pickups & Manifests ── */}
          {currentTab === 'pickups_manifests' && (
            <div className="flex gap-2 mb-4 bg-white/5 border border-white/10 p-1.5 rounded-xl max-w-xs">
              <button
                onClick={() => setManifestSubtab('pickup_ids')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  manifestSubtab === 'pickup_ids' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                Pickup Ids
              </button>
              <button
                onClick={() => setManifestSubtab('manifests')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  manifestSubtab === 'manifests' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                Manifests
              </button>
            </div>
          )}

          {/* Bulk select action banner (when checkboxes are selected) */}
          {Object.values(selectedOrders).filter(Boolean).length > 0 && currentTab !== 'pickups_manifests' && (
            <div className="bg-purple-950/60 border border-purple-500/30 rounded-2xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4 animate-slide-down">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse"></span>
                <span className="text-sm font-semibold text-purple-300">
                  {Object.values(selectedOrders).filter(Boolean).length} Orders Selected
                </span>
              </div>
              <div className="flex gap-2">
                {paginatedOrders.some((o) => selectedOrders[o.id] && isAeShippedOrder(o)) && (
                  <>
                    {(['labels', 'manifests', 'invoices'] as AayshPdfType[]).map((type) => (
                      <button
                        key={type}
                        disabled={aeDocLoading !== null}
                        onClick={() => {
                          const selected = paginatedOrders.filter(
                            (o) => selectedOrders[o.id] && isAeShippedOrder(o),
                          )
                          void handleAirExpressDocuments(type, selected)
                        }}
                        className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-bold text-white transition-colors"
                      >
                        {aeDocLoading === type
                          ? `Printing ${type}…`
                          : `Print ${type === 'labels' ? 'Labels' : type === 'manifests' ? 'Manifests' : 'Invoices'}`}
                      </button>
                    ))}
                  </>
                )}
                {isShipQueueTab && (
                  <button
                    onClick={() => {
                      const firstSel = paginatedOrders.find((o) => selectedOrders[o.id])
                      if (firstSel) setActiveCourierOrder(firstSel)
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-colors"
                  >
                    Bulk Ship Selected
                  </button>
                )}
                {currentTab === 'ready_to_ship' && (
                  <button
                    onClick={() => {
                      const selected = paginatedOrders.filter((o) => selectedOrders[o.id])
                      const ae = selected.filter(isAeShippedOrder)
                      const other = selected.filter((o) => !isAeShippedOrder(o))
                      if (ae.length) void handleAirExpressDocuments('manifests', ae)
                      other.forEach((o) => handleManifestDispatch(o))
                      setSelectedOrders({})
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-colors"
                  >
                    Bulk Download Manifests
                  </button>
                )}
                {currentTab !== 'cancelled' && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="px-4 py-2 rounded-xl bg-red-950/40 hover:bg-red-950/60 border border-red-500/30 text-xs font-bold text-red-400 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" /> : <Trash2 className="w-3.5 h-3.5 text-red-400" />}
                    {bulkDeleting ? 'Cancelling...' : 'Cancel Selected'}
                  </button>
                )}
                {currentTab === 'test_orders' ? (
                  <button
                    onClick={() => handleBulkToggleTest(false)}
                    disabled={bulkTestToggling}
                    className="px-4 py-2 rounded-xl bg-[#854d0e]/20 hover:bg-[#854d0e]/30 border border-amber-500/30 text-xs font-bold text-amber-400 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {bulkTestToggling ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                    {bulkTestToggling ? 'Removing...' : 'Unmark Selected'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleBulkToggleTest(true)}
                    disabled={bulkTestToggling}
                    className="px-4 py-2 rounded-xl bg-purple-950/40 hover:bg-purple-950/60 border border-purple-500/30 text-xs font-bold text-purple-400 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {bulkTestToggling ? <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" /> : <Sparkles className="w-3.5 h-3.5 text-purple-400" />}
                    {bulkTestToggling ? 'Marking...' : 'Mark Selected as Test'}
                  </button>
                )}
                <button
                  onClick={() => setSelectedOrders({})}
                  className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-white hover:bg-white/10"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* ── Render Tables according to shipping states ── */}
          <div className="bg-card rounded-3xl border border-white/10 overflow-hidden shadow-2xl backdrop-blur-2xl relative">
            {/* Page transition overlay */}
            {pageLoading && (
              <div className="absolute inset-0 bg-[#07090e]/60 backdrop-blur-sm z-10 flex items-center justify-center rounded-3xl">
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-5 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  <span className="text-sm text-white/70 font-medium">Loading page {currentPage}...</span>
                </div>
              </div>
            )}
            {loading ? (
              <div className="overflow-hidden">
                {/* Skeleton Table Header */}
                <div className="grid grid-cols-8 gap-4 px-6 py-4 border-b border-white/5">
                  {['Order Details', 'Customer Details', 'Shipping Address', 'Product Details', 'Package Details', 'Payment', 'Pickup Address', ''].map((h, i) => (
                    <div key={i} className="h-3.5 bg-white/5 rounded-md animate-pulse" style={{ width: h ? `${60 + Math.random() * 40}%` : '30%' }} />
                  ))}
                </div>
                {/* Skeleton Rows */}
                {Array.from({ length: 7 }).map((_, rowIdx) => (
                  <div key={rowIdx} className="grid grid-cols-8 gap-4 px-6 py-5 border-b border-white/5" style={{ opacity: 1 - rowIdx * 0.08 }}>
                    {/* Order Details col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-16 bg-white/8 rounded animate-pulse" />
                      <div className="h-2.5 w-24 bg-white/5 rounded animate-pulse" />
                      <div className="h-2.5 w-20 bg-white/5 rounded animate-pulse" />
                    </div>
                    {/* Customer Details col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-28 bg-white/8 rounded animate-pulse" />
                      <div className="h-2.5 w-20 bg-white/5 rounded animate-pulse" />
                      <div className="h-2.5 w-36 bg-white/5 rounded animate-pulse" />
                    </div>
                    {/* Shipping Address col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-32 bg-white/8 rounded animate-pulse" />
                      <div className="h-2.5 w-28 bg-white/5 rounded animate-pulse" />
                      <div className="h-2.5 w-24 bg-white/5 rounded animate-pulse" />
                    </div>
                    {/* Product Details col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-24 bg-white/8 rounded animate-pulse" />
                      <div className="h-2.5 w-20 bg-white/5 rounded animate-pulse" />
                    </div>
                    {/* Package Details col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-20 bg-white/8 rounded animate-pulse" />
                      <div className="h-2.5 w-28 bg-white/5 rounded animate-pulse" />
                    </div>
                    {/* Payment col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-16 bg-white/8 rounded animate-pulse" />
                      <div className="h-5 w-14 bg-purple-500/10 rounded-md animate-pulse" />
                    </div>
                    {/* Pickup Address col */}
                    <div className="space-y-2">
                      <div className="h-3.5 w-16 bg-white/8 rounded animate-pulse" />
                    </div>
                    {/* Actions col */}
                    <div className="flex gap-1.5 items-center">
                      <div className="h-7 w-7 bg-white/5 rounded-lg animate-pulse" />
                      <div className="h-7 w-7 bg-white/5 rounded-lg animate-pulse" />
                    </div>
                  </div>
                ))}
                <div className="py-4 text-center">
                  <p className="text-xs text-white/30 font-medium animate-pulse">Synchronizing with Shopify & Shiprocket API...</p>
                </div>
              </div>
            ) : paginatedOrders.length === 0 && currentTab !== 'pickups_manifests' ? (
              <div className="py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 mx-auto mb-4">
                  <Package className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">No Orders in {tabName(currentTab)}</h3>
                <p className="text-xs text-white/40 max-w-sm mx-auto mb-4">
                  No orders match the current search query or active filter selections.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setDatePreset('30days')
                    setStartDate('')
                    setEndDate('')
                    setFilterChannel('all')
                    setFilterCourier('all')
                    setFilterPickupLocation('all')
                    setFilterWeightClass('all')
                    setFilterRtoRisk('all')
                    setFilterPaymentType('all')
                    setFinancialFilter('all')
                    setFilterFulfillmentStatus('all')
                    setMinPrice('')
                    setMaxPrice('')
                  }}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-all shadow-md"
                >
                  Clear All Filters
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm table-auto border-collapse">
                  
                  {/* Custom headers dynamically rendered per tab with exact min-widths */}
                  <thead>
                    <tr className="text-left text-white/60 bg-white/5 border-b border-white/10 font-semibold">
                      {currentTab !== 'pickups_manifests' && (
                        <th className="px-6 py-4 w-12 text-left">
                          <input
                            type="checkbox"
                            checked={paginatedOrders.length > 0 && paginatedOrders.every((o) => selectedOrders[o.id])}
                            onChange={() => toggleSelectAll(paginatedOrders)}
                            className="rounded border-white/10 bg-white/5 text-purple-600 focus:ring-0 focus:ring-offset-0"
                          />
                        </th>
                      )}
                      
                      {isShipQueueTab && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[220px] text-left">Shipping Address</th>
                          <th className="px-6 py-4 min-w-[180px] text-left">Product Details</th>
                          <th className="px-6 py-4 min-w-[160px] text-left">Package Details</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Pickup Address</th>
                          <th className="px-6 py-4 min-w-[100px] text-left">Status</th>
                          <th className="px-6 py-4 min-w-[140px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'ready_to_ship' && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Pickup Address</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Shipping Details</th>
                          <th className="px-6 py-4 min-w-[150px] text-left">Status</th>
                          <th className="px-6 py-4 min-w-[160px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'pickups_manifests' && (
                        <>
                          <th className="px-6 py-4 min-w-[200px] text-left">Pickup Id / Pickup Request Date</th>
                          <th className="px-6 py-4 min-w-[130px] text-left">Shipment Count</th>
                          <th className="px-6 py-4 min-w-[160px] text-left">Pickup Address</th>
                          <th className="px-6 py-4 min-w-[140px] text-left">Parent Courier</th>
                          <th className="px-6 py-4 min-w-[140px] text-left">Pickup Status</th>
                          <th className="px-6 py-4 min-w-[180px] text-left">Manifest Details</th>
                          <th className="px-6 py-4 min-w-[160px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'in_transit' && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Shipping Details</th>
                          <th className="px-6 py-4 min-w-[130px] text-left">EDD</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Status</th>
                          <th className="px-6 py-4 min-w-[140px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'delivered' && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[130px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Shipping Details</th>
                          <th className="px-6 py-4 min-w-[130px] text-left">Status</th>
                          <th className="px-6 py-4 min-w-[140px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'rto' && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[130px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Shipping Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Reason</th>
                          <th className="px-6 py-4 min-w-[100px] text-left">Status</th>
                          <th className="px-6 py-4 min-w-[140px] text-right">Action</th>
                        </>
                      )}

                      {currentTab === 'cancelled' && (
                        <>
                          <th className="px-6 py-4 min-w-[150px] text-left">Order Details</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer Details</th>
                          <th className="px-6 py-4 min-w-[180px] text-left">Product Details</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Payment</th>
                          <th className="px-6 py-4 min-w-[150px] text-left">Cancelled At</th>
                          <th className="px-6 py-4 min-w-[100px] text-left">Status</th>
                        </>
                      )}

                      {(currentTab === 'all' || currentTab === 'test_orders') && (
                        <>
                          <th className="px-6 py-4 min-w-[140px] text-left">Order</th>
                          <th className="px-6 py-4 min-w-[200px] text-left">Customer</th>
                          <th className="px-6 py-4 min-w-[160px] text-left">Date</th>
                          <th className="px-6 py-4 min-w-[120px] text-left">Financial</th>
                          <th className="px-6 py-4 min-w-[160px] text-left">Fulfillment / Delivery</th>
                          <th className="px-6 py-4 min-w-[120px] text-right">Total</th>
                          <th className="px-6 py-4 min-w-[160px] text-right">Shiprocket AWB</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  
                  {/* Table Body Mapping */}
                  <tbody className="divide-y divide-white/10">
                    {/* Render Pickups & Manifests Mock DB separately */}
                    {currentTab === 'pickups_manifests' ? (
                      manifests.map((m) => (
                        <tr key={m.id} className="hover:bg-white/5 transition-all text-white/90 align-top">
                          <td className="px-6 py-4 font-bold text-purple-400 hover:text-purple-300">
                            {m.id}
                            <p className="text-xs text-white/50 font-normal mt-1">{m.date}</p>
                          </td>
                          <td className="px-6 py-4 text-white/80 font-semibold">{m.shipmentCount}</td>
                          <td className="px-6 py-4 text-white/60 text-xs max-w-[160px] truncate" title={m.address}>
                            {m.address}
                          </td>
                          <td className="px-6 py-4 text-white/70 font-medium">{m.courier}</td>
                          <td className="px-6 py-4">
                            <Badge label={m.status} variant="yellow" />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-bold text-emerald-400">FULLY MANIFESTED</span>
                              <a href="#" className="text-xs text-purple-400 hover:underline inline-flex items-center gap-1 font-medium">
                                <Download className="w-3 h-3" />
                                {m.manifestName} (1 AWB)
                              </a>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => triggerNotification('success', 'Starting manifest PDF fetch...')}
                              className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-colors"
                            >
                              Download Manifest
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      paginatedOrders.map((order) => {
                        const isSelected = !!selectedOrders[order.id]
                        const isPhoneUnmasked = !!unmaskedPhones[order.id]
                        const rtoAssessment = getRtoRisk(order)
                        
                        // Resolve shipping AWB variables
                        const activeShipment = order.fulfillments?.[0]
                        const courierName = activeShipment?.tracking_company || 'Pending Assignment'
                        const awbNumber = activeShipment?.tracking_number || 'Awaiting Courier'

                        const customerName = order.customer
                          ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                          : ''

                        return (
                          <tr
                            key={order.id}
                            onClick={() => setActiveDetailOrder(order)}
                            className={`hover:bg-white/5 cursor-pointer transition-all text-white/90 align-top ${
                              isSelected ? 'bg-purple-950/20' : ''
                            }`}
                          >
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectRow(order.id)}
                                className="rounded border-white/10 bg-white/5 text-purple-600 focus:ring-0 focus:ring-offset-0"
                              />
                            </td>

                            {/* ── NEW / CONFIRMED ORDER TAB ── */}
                            {isShipQueueTab && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(order.created_at).toLocaleString('en-US', {
                                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                      })}
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center text-[8px] font-bold text-emerald-400">S</div>
                                      <span className="text-[10px] text-white/50 font-normal">Fiberise Fit (Shopify)</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName || 'Guest Checkout'}</span>
                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/60 font-normal">
                                        {isPhoneUnmasked ? order.customer?.phone || order.shipping_address?.phone || 'No phone' : 'xxxxxxxxxx'}
                                      </span>
                                      <button onClick={() => togglePhoneMask(order.id)} className="text-white/40 hover:text-white transition-colors">
                                        {isPhoneUnmasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                      </button>
                                    </div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setActiveRtoRiskOrder(order); }}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold mt-1 w-max transition-colors ${
                                        rtoAssessment.color === 'red'
                                          ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                                          : rtoAssessment.color === 'yellow'
                                            ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20'
                                            : 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20'
                                      }`}
                                    >
                                      <ShieldAlert className="w-3 h-3 text-red-400" />
                                      {rtoAssessment.score}
                                    </button>
                                  </div>
                                </td>

                                {/* Shipping address */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  {(() => {
                                    const addr = getOrderShippingAddress(order)
                                    if (!addr?.address1 && !addr?.city) {
                                      return <span className="text-white/40 font-normal">N/A</span>
                                    }
                                    return (
                                      <div
                                        className="flex flex-col gap-0.5 max-w-[220px]"
                                        title={formatShippingAddressFull(addr)}
                                      >
                                        {addr.address1 && (
                                          <span className="text-white/80 font-normal line-clamp-2">{addr.address1}</span>
                                        )}
                                        {addr.address2 && (
                                          <span className="text-white/60 font-normal truncate">{addr.address2}</span>
                                        )}
                                        <span className="text-white/50 font-normal">
                                          {[addr.city, addr.province].filter(Boolean).join(', ')}
                                          {addr.zip ? ` - ${addr.zip}` : ''}
                                        </span>
                                        {addr.country && (
                                          <span className="text-white/40 font-normal">{addr.country}</span>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </td>

                                {/* Product details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[160px]">
                                    <span className="font-semibold text-white truncate" title={order.line_items?.[0]?.title}>
                                      {order.line_items?.[0]?.title || 'No items'}
                                    </span>
                                    {order.line_items?.[0]?.sku && (
                                      <span className="text-white/50 font-normal">SKU: {order.line_items[0].sku}</span>
                                    )}
                                    <span className="text-white/40 font-semibold mt-1">QTY: {order.line_items?.[0]?.quantity || 1}</span>
                                  </div>
                                </td>

                                {/* Package details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 text-white/60">
                                    <span>Dead wt.: <span className="font-semibold text-white/80">0.45 Kg</span></span>
                                    <span>Dimensions: <span className="font-semibold text-white/80">15x10x5 (cm)</span></span>
                                    <div className="flex items-center gap-1 text-[10px] text-yellow-400 font-semibold mt-1">
                                      <Info className="w-3 h-3 shrink-0" />
                                      <span>Info missing</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                  </div>
                                </td>

                                {/* Pickup address */}
                                <td className="px-6 py-4 text-xs text-white/60 font-semibold">
                                  <span className="border-b border-dashed border-white/30 cursor-help" title="FIBERISE PRIMARY HUB - DELHI">
                                    Primary
                                  </span>
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4">
                                  <Badge
                                    label={currentTab === 'confirmed' ? 'CONFIRMED' : 'NEW'}
                                    variant={currentTab === 'confirmed' ? 'green' : 'blue'}
                                  />
                                </td>

                                {/* Actions */}
                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => setActiveCourierOrder(order)}
                                    disabled={actionLoadingOrderId === order.id}
                                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-extrabold text-white transition-all shadow-lg shadow-purple-600/10 disabled:opacity-50"
                                  >
                                    {actionLoadingOrderId === order.id ? (
                                      <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Shipping…
                                      </>
                                    ) : (
                                      'Ship Now'
                                    )}
                                  </button>
                                </td>
                              </>
                            )}

                            {/* ── READY TO SHIP TAB ── */}
                            {currentTab === 'ready_to_ship' && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(order.created_at).toLocaleString()}
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center text-[8px] font-bold text-emerald-400">S</div>
                                      <span className="text-[10px] text-white/50 font-normal">Fiberise Fit (Shopify)</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName}</span>
                                    <span className="text-white/60 font-normal truncate">{order.customer?.email}</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                      className="text-purple-400 hover:underline font-bold mt-1 text-[10px] w-max text-left"
                                    >
                                      View Products →
                                    </button>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                  </div>
                                </td>

                                {/* Pickup address */}
                                <td className="px-6 py-4 text-xs text-white/60 font-semibold">
                                  <span className="border-b border-dashed border-white/30 cursor-help" title="FIBERISE PRIMARY HUB - DELHI">
                                    Primary
                                  </span>
                                </td>

                                {/* Shipping Details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5 text-white/70">
                                    <span className="font-bold text-white text-sm shrink-0 flex items-center gap-1">
                                      <Truck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                      {courierName}
                                    </span>
                                    <div className="flex items-center gap-1.5 font-normal" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/40">AWB#:</span>
                                      <span
                                        onClick={() => setActiveTrackingOrder(order)}
                                        className="font-mono text-purple-300 hover:text-purple-200 cursor-pointer underline"
                                      >
                                        {awbNumber}
                                      </span>
                                    </div>
                                    <span className="text-white/40 text-[10px] font-normal mt-0.5">
                                      Assigned: {new Date().toLocaleDateString()} | 09:40 AM
                                    </span>
                                  </div>
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <Badge label="PICKUP SCHEDULED" variant="yellow" />
                                    <span className="text-white/40 text-[10px] font-normal">For {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                                    <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                      Label Downloaded
                                    </span>
                                  </div>
                                </td>

                                {/* Action */}
                                <td className="px-6 py-4 text-right font-medium" onClick={(e) => e.stopPropagation()}>
                                  {isAeShippedOrder(order) ? (
                                    <AirExpressDocumentsButtons
                                      orderIds={[order.id]}
                                      onError={(msg) => triggerNotification('error', msg)}
                                      onSuccess={(type) =>
                                        triggerNotification(
                                          'success',
                                          `Air Express ${type === 'labels' ? 'label' : type === 'manifests' ? 'manifest' : 'invoice'} generated`,
                                        )
                                      }
                                    />
                                  ) : (
                                    <button
                                      onClick={() => handleManifestDispatch(order)}
                                      disabled={actionLoadingOrderId === order.id}
                                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-extrabold text-white transition-all shadow-lg active:scale-95"
                                    >
                                      {actionLoadingOrderId === order.id ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          Dispatched...
                                        </>
                                      ) : (
                                        'Download Manifest'
                                      )}
                                    </button>
                                  )}
                                </td>
                              </>
                            )}

                            {/* ── IN TRANSIT TAB ── */}
                            {currentTab === 'in_transit' && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(order.created_at).toLocaleString()}
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center text-[8px] font-bold text-emerald-400">S</div>
                                      <span className="text-[10px] text-white/50 font-normal">Fiberise Fit (Shopify)</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName}</span>
                                    <span className="text-white/60 font-normal truncate">{order.customer?.email}</span>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                  </div>
                                </td>

                                {/* Shipping Details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5 text-white/70">
                                    <span className="font-bold text-white text-sm shrink-0 flex items-center gap-1">
                                      <Truck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                      {courierName}
                                    </span>
                                    <div className="flex items-center gap-1.5 font-normal" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/40">AWB#:</span>
                                      <span
                                        onClick={() => setActiveTrackingOrder(order)}
                                        className="font-mono text-purple-300 hover:text-purple-200 cursor-pointer underline"
                                      >
                                        {awbNumber}
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* EDD */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[130px]" onClick={(e) => e.stopPropagation()}>
                                    <span className="font-bold text-white">{new Date(Date.now() + 3*24*60*60*1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    <span
                                      onClick={() => setActiveTrackingOrder(order)}
                                      className="text-purple-400 hover:underline font-bold text-[10px] w-max cursor-pointer text-left"
                                    >
                                      View EDD History →
                                    </span>
                                  </div>
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 font-medium">
                                  <Badge label="IN TRANSIT" variant="yellow" />
                                </td>

                                {/* Action */}
                                <td className="px-6 py-4 text-right font-medium" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex flex-col items-end gap-2">
                                    {isAeShippedOrder(order) && (
                                      <AirExpressDocumentsButtons
                                        orderIds={[order.id]}
                                        onError={(msg) => triggerNotification('error', msg)}
                                      />
                                    )}
                                    <button
                                      onClick={() => setActiveTrackingOrder(order)}
                                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-extrabold text-white transition-all shadow-lg shadow-purple-600/10"
                                    >
                                      Track Order
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}

                            {/* ── DELIVERED TAB ── */}
                            {currentTab === 'delivered' && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(order.created_at).toLocaleString()}
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <div className="w-4 h-4 rounded-full bg-emerald-500/10 flex items-center justify-center text-[8px] font-bold text-emerald-400">S</div>
                                      <span className="text-[10px] text-white/50 font-normal">Fiberise Fit (Shopify)</span>
                                    </div>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName}</span>
                                    <span className="text-white/60 font-normal truncate">{order.customer?.email}</span>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                    {isCodOrder(order) && (
                                      <span className="text-[9px] text-white/40 mt-1.5 max-w-[130px] font-normal leading-normal">
                                        Remittance: {new Date(Date.now() + 5*24*60*60*1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {new Date(Date.now() + 8*24*60*60*1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Shipping Details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5 text-white/70">
                                    <span className="font-bold text-white text-sm shrink-0 flex items-center gap-1">
                                      <Truck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                      {courierName}
                                    </span>
                                    <div className="flex items-center gap-1.5 font-normal" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/40">AWB#:</span>
                                      <span
                                        onClick={() => setActiveTrackingOrder(order)}
                                        className="font-mono text-purple-300 hover:text-purple-200 cursor-pointer underline"
                                      >
                                        {awbNumber}
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <Badge label="DELIVERED" variant="green" />
                                    <span className="text-white/40 text-[10px] font-semibold">On {new Date(Date.now() - 2*24*60*60*1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded w-max">✓ Verified</span>
                                  </div>
                                </td>

                                {/* Action */}
                                <td className="px-6 py-4 text-right font-medium" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => triggerNotification('success', 'Return flow initiated. Generating Shiprocket return order...')}
                                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-extrabold text-white transition-all shadow-lg active:scale-95"
                                  >
                                    Create Return
                                  </button>
                                </td>
                              </>
                            )}

                            {/* ── RTO TAB ── */}
                            {currentTab === 'rto' && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(activeShipment?.created_at || order.created_at).toLocaleString('en-US', {
                                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                      })}
                                    </span>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName}</span>
                                    <span className="text-white/60 font-normal truncate">{order.customer?.email}</span>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                  </div>
                                </td>

                                {/* Shipping Details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1.5 text-white/70">
                                    <span className="font-bold text-white text-sm shrink-0 flex items-center gap-1">
                                      <Truck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                      {courierName}
                                    </span>
                                    <div className="flex items-center gap-1.5 font-normal" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/40">AWB#:</span>
                                      <span
                                        onClick={() => setActiveTrackingOrder(order)}
                                        className="font-mono text-purple-300 hover:text-purple-200 cursor-pointer underline"
                                      >
                                        {awbNumber}
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* RTO Reason */}
                                <td className="px-6 py-4 text-xs text-red-300 font-bold max-w-[200px] leading-relaxed">
                                  {activeShipment?.shipment_status_reason || '—'}
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 font-medium">
                                  <Badge label="RTO" variant="red" />
                                </td>

                                {/* Action */}
                                <td className="px-6 py-4 text-right font-medium" onClick={(e) => e.stopPropagation()}>
                                  <div className="relative inline-block text-left">
                                    <button
                                      onClick={() => setActiveDropdownOrderId(activeDropdownOrderId === order.id ? null : order.id)}
                                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-all active:scale-95 flex items-center justify-center shrink-0"
                                    >
                                      <MoreHorizontal className="w-5 h-5" />
                                    </button>

                                    {activeDropdownOrderId === order.id && (
                                      <>
                                        <div 
                                          className="fixed inset-0 z-10" 
                                          onClick={() => setActiveDropdownOrderId(null)}
                                        />
                                        <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#0e121a] border border-white/10 shadow-2xl z-20 py-1.5 focus:outline-none animate-fade-in text-left">
                                          <button
                                            onClick={() => {
                                              setActiveDropdownOrderId(null);
                                              triggerNotification('success', 'Support ticket creation initiated.');
                                            }}
                                            className="w-full px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-purple-600/20 text-left transition-colors font-medium"
                                          >
                                            Create Ticket
                                          </button>
                                          <button
                                            onClick={() => {
                                              setActiveDropdownOrderId(null);
                                              if (isAeShippedOrder(order)) {
                                                void handleAirExpressDocuments('invoices', [order])
                                              } else {
                                                triggerNotification('success', 'Fetching order invoice PDF...');
                                              }
                                            }}
                                            className="w-full px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-purple-600/20 text-left transition-colors font-medium"
                                          >
                                            Download Invoice
                                          </button>
                                          <button
                                            onClick={() => {
                                              setActiveDropdownOrderId(null);
                                              triggerNotification('success', 'Order tag modal triggered.');
                                            }}
                                            className="w-full px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-purple-600/20 text-left transition-colors font-medium"
                                          >
                                            Add Order Tag
                                          </button>
                                          <div className="h-px bg-white/5 my-1" />
                                          <button
                                            onClick={() => handleCloneOrder(order)}
                                            className="w-full px-4 py-2 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-600/20 text-left transition-colors font-semibold"
                                          >
                                            Clone Order
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </>
                            )}

                            {/* ── CANCELLED TAB ── */}
                            {currentTab === 'cancelled' && (
                              <>
                                {/* Order details */}
                                <td className="px-6 py-4">
                                  <div className="flex flex-col font-medium">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                        className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer text-sm"
                                      >
                                        {order.name}
                                      </span>
                                      <CareOrderTagBadge tag={order.care_tag} />
                                    </div>
                                    <span className="text-xs text-white/50 mt-1 font-normal">
                                      {new Date(order.created_at).toLocaleString('en-US', {
                                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                      })}
                                    </span>
                                  </div>
                                </td>

                                {/* Customer details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[180px]">
                                    <span className="font-bold text-sm text-white">{customerName || 'Guest Checkout'}</span>
                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-white/60 font-normal">
                                        {isPhoneUnmasked ? order.customer?.phone || order.shipping_address?.phone || 'No phone' : 'xxxxxxxxxx'}
                                      </span>
                                      <button onClick={() => togglePhoneMask(order.id)} className="text-white/40 hover:text-white transition-colors">
                                        {isPhoneUnmasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                </td>

                                {/* Product details */}
                                <td className="px-6 py-4 text-xs font-medium">
                                  <div className="flex flex-col gap-1 max-w-[160px]">
                                    <span className="font-semibold text-white truncate" title={order.line_items?.[0]?.title}>
                                      {order.line_items?.[0]?.title || 'No items'}
                                    </span>
                                    <span className="text-white/40 font-semibold mt-1">QTY: {order.line_items?.[0]?.quantity || 1}</span>
                                  </div>
                                </td>

                                {/* Payment */}
                                <td className="px-6 py-4 font-medium">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-bold text-sm text-white">₹{order.total_price}</span>
                                    <Badge
                                      label={getPaymentLabel(order)}
                                      variant={isCodOrder(order) ? 'yellow' : 'green'}
                                    />
                                  </div>
                                </td>

                                {/* Cancelled At */}
                                <td className="px-6 py-4 text-xs text-red-400 font-semibold">
                                  {order.cancelled_at ? new Date(order.cancelled_at).toLocaleString('en-US', {
                                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                  }) : 'N/A'}
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4">
                                  <Badge label="CANCELLED" variant="red" />
                                </td>
                              </>
                            )}

                            {/* ── ALL ORDERS TAB ── */}
                            {(currentTab === 'all' || currentTab === 'test_orders') && (
                              <>
                                <td className="px-6 py-3 text-white">
                                  <div className="flex flex-col font-medium">
                                    <span
                                      onClick={(e) => { e.stopPropagation(); setActiveDetailOrder(order); }}
                                      className="font-bold text-purple-300 hover:text-purple-200 cursor-pointer flex items-center gap-1.5 flex-wrap"
                                    >
                                      {order.name}
                                      <CareOrderTagBadge tag={order.care_tag} />
                                      {(order as any).is_test_order && <Badge label="TEST" variant="red" />}
                                    </span>
                                    <span className="text-xs text-white/50 font-normal">ID: {order.id}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-3 text-white/80 font-medium">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-semibold text-white">{customerName || 'Guest'}</span>
                                    {order.customer?.email && (
                                      <span className="text-xs text-white/50 font-normal truncate max-w-[180px]">{order.customer.email}</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-3 text-white/80 font-normal">
                                  {new Date(order.created_at).toLocaleString()}
                                </td>
                                <td className="px-6 py-3">
                                  <Badge label={order.financial_status || 'N/A'} variant={statusVariant(order.financial_status)} />
                                </td>
                                <td className="px-6 py-3 font-medium">
                                  {(() => {
                                    const delInfo = getDeliveryStatusInfo(order)
                                    return <Badge label={delInfo.label} variant={delInfo.variant} />
                                  })()}
                                </td>
                                <td className="px-6 py-3 text-right text-white font-extrabold">
                                  {order.total_price} {order.currency}
                                </td>
                                <td className="px-6 py-3 text-right text-xs" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5 font-medium">
                                    <span
                                      onClick={() => setActiveTrackingOrder(order)}
                                      className="font-mono text-purple-300 hover:text-purple-200 underline cursor-pointer"
                                    >
                                      {awbNumber}
                                    </span>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {totalOrders > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-white/10 px-2 select-none">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <p className="text-xs text-white/50 font-normal">
                      Showing <span className="font-bold text-white">{totalOrders === 0 ? 0 : startIndex + 1}</span> to{' '}
                      <span className="font-bold text-white">{Math.min(endIndex, totalOrders)}</span> of{' '}
                      <span className="font-bold text-white">{totalOrders}</span> orders
                    </p>
                    <label className="inline-flex items-center gap-2 text-xs text-white/50">
                      <span>Per page</span>
                      <select
                        value={ordersPerPage}
                        onChange={(e) =>
                          setOrdersPerPage(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
                        }
                        className="px-2 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80"
                      >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all font-semibold"
                      >
                        First
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all font-semibold"
                      >
                        Prev
                      </button>

                      {Array.from({ length: totalPages }).map((_, i) => {
                        const pageNum = i + 1
                        if (pageNum === 1 || pageNum === totalPages || Math.abs(pageNum - currentPage) <= 1) {
                          return (
                            <button
                              key={pageNum}
                              type="button"
                              onClick={() => setCurrentPage(pageNum)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                currentPage === pageNum
                                  ? 'bg-purple-600 border border-purple-500 text-white shadow-lg shadow-purple-500/20'
                                  : 'border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {pageNum}
                            </button>
                          )
                        }
                        if (pageNum === 2 || pageNum === totalPages - 1) {
                          return (
                            <span key={pageNum} className="text-white/40 text-xs px-1 select-none">
                              ...
                            </span>
                          )
                        }
                        return null
                      })}

                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all font-semibold"
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 transition-all font-semibold"
                      >
                        Last
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>

      {/* ── EXPORT TO SHEETS MODAL ── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-card border border-white/10 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative animate-scale-up max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowExportModal(false)}
              className="absolute right-4 top-4 order-drawer-muted hover:opacity-80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 dark:text-emerald-400">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>Export to Sheets</h3>
                <p className="text-xs order-drawer-muted font-normal">Choose order range, date range, and columns to export</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider order-drawer-muted mb-1.5">
                    From Order ID
                  </label>
                  <input
                    type="text"
                    value={exportFromOrderId}
                    onChange={(e) => setExportFromOrderId(e.target.value)}
                    placeholder="e.g. R_1650 or 1650"
                    className="crm-input w-full px-4 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider order-drawer-muted mb-1.5">
                    To Order ID
                  </label>
                  <input
                    type="text"
                    value={exportToOrderId}
                    onChange={(e) => setExportToOrderId(e.target.value)}
                    placeholder="e.g. R_1670 or 1670"
                    className="crm-input w-full px-4 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider order-drawer-muted mb-1.5">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={exportFromDate}
                    onChange={(e) => setExportFromDate(e.target.value)}
                    className="crm-input w-full px-4 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider order-drawer-muted mb-1.5">
                    Till Date
                  </label>
                  <input
                    type="date"
                    value={exportToDate}
                    onChange={(e) => setExportToDate(e.target.value)}
                    className="crm-input w-full px-4 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider order-drawer-muted">
                    Columns to Export
                  </label>
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setSelectedExportColumns(ALL_EXPORT_COLUMN_KEYS)}
                      className="text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      Select All
                    </button>
                    <span className="order-drawer-muted">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedExportColumns([])}
                      className="order-drawer-muted hover:underline"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="order-drawer-surface rounded-2xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                  {EXPORT_COLUMNS.map((col) => {
                    const checked = selectedExportColumns.includes(col.key)
                    return (
                      <label
                        key={col.key}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                          checked
                            ? 'bg-emerald-500/10 border border-emerald-500/25'
                            : 'hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedExportColumns((prev) =>
                              prev.includes(col.key)
                                ? prev.filter((k) => k !== col.key)
                                : [...prev, col.key]
                            )
                          }}
                          className="rounded border-white/20 bg-white/5 text-emerald-600 focus:ring-emerald-500/30 focus:ring-offset-0"
                        />
                        <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                          {col.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="text-[11px] order-drawer-muted mt-2">
                  {selectedExportColumns.length} of {EXPORT_COLUMNS.length} columns selected
                </p>
              </div>

              <p className="text-[11px] order-drawer-muted leading-relaxed">
                Current tab filters and search still apply. Provide an Order ID range and/or a date range. Only matching orders and selected columns will be exported.
              </p>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 py-2.5 rounded-xl order-drawer-surface text-xs font-bold hover:opacity-90 transition-all"
                style={{ color: 'var(--foreground-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleExportToSheets()}
                disabled={exporting || selectedExportColumns.length === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-xs font-bold text-white transition-all disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SHIP PROVIDER → RATES → CONFIRM ── */}
      {activeCourierOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0e121a] border border-white/10 rounded-3xl w-full max-w-2xl p-6 shadow-2xl relative animate-scale-up max-h-[90vh] overflow-y-auto">
            <button
              onClick={resetShipModal}
              className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                  shipSelectedProvider === 'air_express'
                    ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
                    : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                }`}
              >
                {shipSelectedProvider === 'air_express' ? (
                  <Plane className="w-5 h-5" />
                ) : (
                  <Truck className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {shipModalStep === 'provider' ? 'Choose Shipping Provider' : 'Select Delivery Partner'}
                </h3>
                <p className="text-xs text-white/50 font-normal">
                  {shipModalStep === 'provider'
                    ? `Ship order ${activeCourierOrder.name} on the original order (no clone)`
                    : `${shipSelectedProvider === 'air_express' ? 'Air Express' : 'Shiprocket'} · ${activeCourierOrder.name}`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 mb-6 text-xs font-semibold">
              <div>
                <p className="text-white/40 font-normal">Customer</p>
                <p className="font-bold text-white mt-0.5">
                  {activeCourierOrder.customer?.first_name} {activeCourierOrder.customer?.last_name}
                </p>
              </div>
              <div>
                <p className="text-white/40 font-normal">Destination</p>
                <p className="font-bold text-white mt-0.5">
                  {activeCourierOrder.shipping_address?.city}, {activeCourierOrder.shipping_address?.zip}
                </p>
              </div>
              <div>
                <p className="text-white/40 font-normal">Weight / Size</p>
                <p className="font-bold text-white mt-0.5">0.45 Kg (15x10x5 cm)</p>
              </div>
              <div>
                <p className="text-white/40 font-normal">COD / Prepaid</p>
                <p className="font-bold text-white mt-0.5">
                  {isCodOrder(activeCourierOrder)
                    ? `COD (Collect ₹${activeCourierOrder.total_price})`
                    : 'Prepaid (₹0.00 to collect)'}
                </p>
              </div>
            </div>

            {shipModalStep === 'provider' && (
              <>
                <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">
                  Select provider
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="rounded-2xl border border-purple-500/25 bg-purple-500/5 p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-300">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Ship via Shiprocket</p>
                        <p className="text-[11px] text-white/45">See courier rates, then confirm</p>
                      </div>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      Loads available Shiprocket partners with live freight prices for this pincode.
                    </p>
                    <button
                      type="button"
                      disabled={actionLoadingOrderId === activeCourierOrder.id}
                      onClick={() => openShipRates('shiprocket', activeCourierOrder)}
                      className="mt-auto inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      View Shiprocket rates
                    </button>
                  </div>

                  <div className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-sky-500/15 flex items-center justify-center text-sky-300">
                        <Plane className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Ship via Air Express</p>
                        <p className="text-[11px] text-white/45">Choose service, then confirm</p>
                      </div>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      Shows Air Express service options (Surface / Air / Prime), then creates order + AWB.
                    </p>
                    <button
                      type="button"
                      disabled={actionLoadingOrderId === activeCourierOrder.id}
                      onClick={() => openShipRates('air_express', activeCourierOrder)}
                      className="mt-auto inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <Plane className="w-3.5 h-3.5" />
                      View Air Express options
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetShipModal}
                  className="w-full py-2.5 rounded-xl border border-white/10 text-xs font-bold text-white/70 hover:bg-white/5"
                >
                  Cancel
                </button>
              </>
            )}

            {shipModalStep === 'rates' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-white/40">
                    Delivery partners
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShipModalStep('provider')
                      setShipSelectedProvider(null)
                      setShipCourierOptions([])
                      setSelectedShipOptionId(null)
                      setShipRatesError(null)
                    }}
                    className="text-[11px] font-bold text-white/50 hover:text-white"
                  >
                    ← Change provider
                  </button>
                </div>

                {shipRatesLoading && (
                  <div className="flex items-center justify-center gap-2 py-10 text-white/60 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading rates…
                  </div>
                )}

                {!shipRatesLoading && shipRatesError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 mb-4">
                    {shipRatesError}
                  </div>
                )}

                {!shipRatesLoading && !shipRatesError && shipCourierOptions.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-xs text-white/50 mb-4">
                    No delivery partners available for this destination.
                  </div>
                )}

                {!shipRatesLoading && shipCourierOptions.length > 0 && (
                  <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto pr-1">
                    {shipCourierOptions.map((opt, idx) => {
                      const selected = selectedShipOptionId === opt.id
                      const accent =
                        shipSelectedProvider === 'air_express' ? 'sky' : 'purple'
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedShipOptionId(opt.id)}
                          className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                            selected
                              ? accent === 'sky'
                                ? 'border-sky-500/50 bg-sky-500/10'
                                : 'border-purple-500/50 bg-purple-500/10'
                              : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <span
                                className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                                  selected
                                    ? accent === 'sky'
                                      ? 'border-sky-400 bg-sky-400'
                                      : 'border-purple-400 bg-purple-400'
                                    : 'border-white/30'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-white truncate">{opt.name}</p>
                                <p className="text-[11px] text-white/45 mt-0.5">
                                  {opt.etd ? `ETD: ${opt.etd}` : 'Standard transit'}
                                  {opt.rating != null ? ` · ★ ${opt.rating}` : ''}
                                  {idx === 0 && opt.rate != null ? ' · Lowest' : ''}
                                </p>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              {opt.rate != null ? (
                                <p className="text-base font-bold text-white">
                                  ₹{Number(opt.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                </p>
                              ) : (
                                <p className="text-xs font-bold text-white/70">
                                  {opt.rateLabel || 'As per contract'}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={resetShipModal}
                    disabled={actionLoadingOrderId === activeCourierOrder.id}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 text-xs font-bold text-white/70 hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      actionLoadingOrderId === activeCourierOrder.id ||
                      !selectedShipOptionId ||
                      shipRatesLoading ||
                      Boolean(shipRatesError)
                    }
                    onClick={handleConfirmSelectedShip}
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-50 ${
                      shipSelectedProvider === 'air_express'
                        ? 'bg-sky-600 hover:bg-sky-500'
                        : 'bg-purple-600 hover:bg-purple-500'
                    }`}
                  >
                    {shipLoadingProvider ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Shipping…
                      </>
                    ) : (
                      <>
                        {shipSelectedProvider === 'air_express' ? (
                          <Plane className="w-3.5 h-3.5" />
                        ) : (
                          <Truck className="w-3.5 h-3.5" />
                        )}
                        Confirm & Ship
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TRACKING TIMELINE DRAWER ── */}
      {activeTrackingOrder && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0e121a] border-l border-white/10 w-full max-w-md h-full p-6 shadow-2xl relative flex flex-col animate-slide-left">
            <button
              onClick={() => setActiveTrackingOrder(null)}
              className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Compass className="w-5 h-5" />
              </div>
              <div className="font-semibold">
                <h3 className="text-lg font-bold text-white">Tracking Details</h3>
                <p className="text-xs text-white/50 font-normal">{activeTrackingOrder.name} · {activeTrackingOrder.fulfillments?.[0]?.tracking_company}</p>
              </div>
            </div>

            {/* AWB Card */}
            <div className="bg-white/5 border border-white/5 p-4 rounded-2xl mb-6 text-xs space-y-2 font-semibold">
              <div className="flex justify-between">
                <span className="text-white/40 font-normal">AWB Code</span>
                <span className="font-mono font-bold text-purple-300">{activeTrackingOrder.fulfillments?.[0]?.tracking_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 font-normal">Courier Partner</span>
                <span className="font-bold text-white">{activeTrackingOrder.fulfillments?.[0]?.tracking_company}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 font-normal">Estimated Delivery</span>
                <span className="font-bold text-emerald-400">22 May 2026</span>
              </div>
            </div>

            <p className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-4">Shipment Journey</p>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto space-y-6 pl-2 relative border-l border-white/10 ml-3">
              {/* Event 1 */}
              <div className="relative pl-6">
                <div className="absolute -left-[29px] top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border border-[#0e121a] flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                </div>
                <div>
                  <p className="text-xs text-white/40">18 May 2026 | 02:00 PM</p>
                  <p className="text-sm font-bold text-white mt-0.5">Package Picked Up</p>
                  <p className="text-xs text-white/60 mt-0.5 font-medium">Shipment picked up by courier from primary warehouse location.</p>
                </div>
              </div>

              {/* Event 2 */}
              <div className="relative pl-6">
                <div className="absolute -left-[29px] top-1 w-3.5 h-3.5 rounded-full bg-purple-500/50 border border-[#0e121a] flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-300"></span>
                </div>
                <div>
                  <p className="text-xs text-white/40">18 May 2026 | 09:40 AM</p>
                  <p className="text-sm font-bold text-white mt-0.5">AWB Manifest Generated</p>
                  <p className="text-xs text-white/60 mt-0.5 font-medium">AWB tracking allocated. Manifest printed and labeled onto parcel package.</p>
                </div>
              </div>

              {/* Event 3 */}
              <div className="relative pl-6 opacity-60">
                <div className="absolute -left-[29px] top-1 w-3.5 h-3.5 rounded-full bg-white/10 border border-[#0e121a] flex items-center justify-center"></div>
                <div>
                  <p className="text-xs text-white/40">18 May 2026 | 09:00 AM</p>
                  <p className="text-sm font-bold text-white mt-0.5">Fulfillment Triggered</p>
                  <p className="text-xs text-white/60 mt-0.5 font-medium">Order resolved inside warehouse. Packing finalized.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setActiveTrackingOrder(null)}
              className="w-full mt-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white hover:bg-white/10 transition-all text-center"
            >
              Close Panel
            </button>
          </div>
        </div>
      )}

      {/* ── RTO RISK ASSESSMENT DETAIL DIALOG ── */}
      {activeRtoRiskOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0e121a] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl relative animate-scale-up">
            <button
              onClick={() => setActiveRtoRiskOrder(null)}
              className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="font-semibold">
                <h3 className="text-lg font-bold text-white">RTO Risk Analysis</h3>
                <p className="text-xs text-white/50 font-normal">Predictive analysis report for order {activeRtoRiskOrder.name}</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mb-6 text-center font-semibold">
              <p className="text-xs text-white/50 uppercase tracking-wide font-normal">Risk Assessment Score</p>
              <p className={`text-3xl font-extrabold mt-1 ${
                getRtoRisk(activeRtoRiskOrder).color === 'red'
                  ? 'text-red-400'
                  : getRtoRisk(activeRtoRiskOrder).color === 'yellow'
                    ? 'text-yellow-400'
                    : 'text-emerald-400'
              }`}>
                {getRtoRisk(activeRtoRiskOrder).pct}
              </p>
            </div>

            <p className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3">Identified Risk Factors</p>
            <div className="space-y-2 mb-6">
              {getRtoRisk(activeRtoRiskOrder).factors.map((f, i) => (
                <div key={i} className="flex items-start gap-2.5 text-xs text-white/80 p-2.5 rounded-xl bg-white/5 border border-white/5 font-semibold font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0"></div>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  triggerNotification('success', 'RTO protection lock applied to this shipment.')
                  setActiveRtoRiskOrder(null)
                }}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white transition-all text-center animate-pulse"
              >
                Secure Order
              </button>
              <button
                onClick={() => setActiveRtoRiskOrder(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white hover:bg-white/10 transition-all text-center"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GORGEOUS SLIDING ORDER DETAILS DRAWER ── */}
      {activeDetailOrder && (
        <div className="order-drawer-overlay fixed inset-0 z-50 flex justify-end backdrop-blur-sm animate-fade-in" onClick={() => { setActiveDetailOrder(null); setDrawerPhoneRevealed(false) }}>
          <div
            className="order-drawer-panel border-l w-full max-w-xl h-full p-6 shadow-2xl relative flex flex-col animate-slide-left overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => { setActiveDetailOrder(null); setDrawerPhoneRevealed(false) }}
              className="absolute right-4 top-4 order-drawer-muted hover:opacity-80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header info */}
            <div className="flex items-center gap-3 mb-6 border-b order-drawer-divider pb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xl font-extrabold flex items-center gap-2">
                    {activeDetailOrder.name}
                    {(activeDetailOrder as any).is_test_order && <Badge label="TEST ORDER" variant="red" />}
                  </h3>
                  <Badge label={activeDetailOrder.financial_status} variant={statusVariant(activeDetailOrder.financial_status)} />
                  <Badge label={activeDetailOrder.fulfillment_status ?? 'Unfulfilled'} variant={statusVariant(activeDetailOrder.fulfillment_status)} />
                </div>
                <p className="text-xs order-drawer-muted mt-1">Placed on {new Date(activeDetailOrder.created_at).toLocaleString()}</p>
              </div>
            </div>

            <div className="flex-1 space-y-6">
              {/* Items Summary */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-3 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Items Ordered
                </p>
                <div className="order-drawer-surface p-4 rounded-2xl divide-y space-y-3" style={{ borderColor: 'var(--border)' }}>
                  {activeDetailOrder.line_items.map((item, idx) => (
                    <div key={item.id} className={`flex items-start justify-between gap-4 text-xs ${idx > 0 ? 'pt-3 border-t order-drawer-divider' : ''}`}>
                      <div className="flex-1">
                        <p className="font-bold">{item.title}</p>
                        {item.variant_title && (
                          <p className="order-drawer-muted text-[10px] mt-0.5">{item.variant_title}</p>
                        )}
                        {item.sku && <p className="order-drawer-muted text-[10px] opacity-80">SKU: {item.sku}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold">
                          ₹{item.price} × {item.quantity}
                        </p>
                        <p className="order-drawer-muted text-[10px] mt-0.5">{item.fulfillment_status ?? 'Unfulfilled'}</p>
                      </div>
                    </div>
                  ))}

                  {/* Pricing Breakdown */}
                  <div className="pt-3 border-t order-drawer-divider space-y-1.5 text-xs order-drawer-muted">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-semibold" style={{ color: 'var(--foreground)' }}>₹{parseFloat(activeDetailOrder.total_price) - 40}.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping Fees</span>
                      <span className="font-semibold" style={{ color: 'var(--foreground)' }}>₹40.00</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t order-drawer-divider text-sm font-bold">
                      <span>Total Amount</span>
                      <span className="text-purple-600 dark:text-purple-400">₹{activeDetailOrder.total_price} INR</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer summary */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-3 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  Customer Details
                </p>
                <div className="order-drawer-surface p-4 rounded-2xl text-xs space-y-2.5 font-semibold">
                  <div className="flex justify-between gap-4">
                    <span className="order-drawer-muted font-normal shrink-0">Contact Name</span>
                    <span className="text-right">
                      {activeDetailOrder.customer?.first_name} {activeDetailOrder.customer?.last_name}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="order-drawer-muted font-normal shrink-0">Email Address</span>
                    <span className="truncate max-w-[200px] text-right" title={activeDetailOrder.customer?.email || ''}>
                      {activeDetailOrder.customer?.email || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="order-drawer-muted font-normal shrink-0">Phone Coordinates</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        {drawerPhoneRevealed
                          ? (activeDetailOrder.customer?.phone || activeDetailOrder.shipping_address?.phone || 'N/A')
                          : 'xxxxxxxxxx'
                        }
                      </span>
                      <button
                        onClick={() => setDrawerPhoneRevealed(v => !v)}
                        className="order-drawer-muted hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                        title={drawerPhoneRevealed ? 'Hide phone' : 'Reveal phone'}
                      >
                        {drawerPhoneRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Addresses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Shipping Address
                  </p>
                  <div className="order-drawer-surface p-4 rounded-2xl text-xs leading-relaxed font-semibold">
                    <p className="font-bold mb-1">
                      {activeDetailOrder.shipping_address?.first_name} {activeDetailOrder.shipping_address?.last_name}
                    </p>
                    <p className="font-normal order-drawer-muted">{activeDetailOrder.shipping_address?.address1}</p>
                    {activeDetailOrder.shipping_address?.address2 && (
                      <p className="font-normal order-drawer-muted">{activeDetailOrder.shipping_address.address2}</p>
                    )}
                    <p className="font-normal order-drawer-muted">
                      {activeDetailOrder.shipping_address?.city}, {activeDetailOrder.shipping_address?.province} - {activeDetailOrder.shipping_address?.zip}
                    </p>
                    <div className="flex items-center gap-1.5 font-normal order-drawer-muted mt-1">
                      <span>Ph:</span>
                      <span className="font-mono">
                        {drawerPhoneRevealed
                          ? (activeDetailOrder.shipping_address?.phone || activeDetailOrder.customer?.phone || 'N/A')
                          : 'xxxxxxxxxx'
                        }
                      </span>
                      <button
                        onClick={() => setDrawerPhoneRevealed(v => !v)}
                        className="order-drawer-muted hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                        title={drawerPhoneRevealed ? 'Hide phone' : 'Reveal phone'}
                      >
                        {drawerPhoneRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Billing Address
                  </p>
                  <div className="order-drawer-surface p-4 rounded-2xl text-xs leading-relaxed font-semibold">
                    <p className="font-bold mb-1">
                      {activeDetailOrder.billing_address?.first_name} {activeDetailOrder.billing_address?.last_name}
                    </p>
                    <p className="font-normal order-drawer-muted">{activeDetailOrder.billing_address?.address1}</p>
                    <p className="font-normal order-drawer-muted">
                      {activeDetailOrder.billing_address?.city}, {activeDetailOrder.billing_address?.province} - {activeDetailOrder.billing_address?.zip}
                    </p>
                  </div>
                </div>
              </div>

              {/* Courier logistics + Air Express documents */}
              {(activeDetailOrder.fulfillment_status === 'fulfilled' || isAeShippedOrder(activeDetailOrder)) && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider order-drawer-section-title mb-3 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    {isAeShippedOrder(activeDetailOrder) ? 'Air Express Documents' : 'Shiprocket Courier Routing'}
                  </p>
                  <div className="order-drawer-surface p-4 rounded-2xl text-xs space-y-2.5 font-semibold">
                    <div className="flex justify-between gap-4">
                      <span className="order-drawer-muted font-normal">Assigned Courier</span>
                      <span>{activeDetailOrder.fulfillments?.[0]?.tracking_company}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="order-drawer-muted font-normal">AWB Number</span>
                      <span className="font-mono text-purple-600 dark:text-purple-300 underline cursor-pointer hover:opacity-80" onClick={() => { setActiveDetailOrder(null); setActiveTrackingOrder(activeDetailOrder); }}>
                        {activeDetailOrder.fulfillments?.[0]?.tracking_number}
                      </span>
                    </div>
                    {isAeShippedOrder(activeDetailOrder) && (activeDetailOrder.airExpressShipmentId || activeDetailOrder.fulfillments?.[0]?.id) && (
                      <div className="flex justify-between gap-4">
                        <span className="order-drawer-muted font-normal">Shipment ID</span>
                        <span className="font-mono">
                          {activeDetailOrder.airExpressShipmentId || activeDetailOrder.fulfillments?.[0]?.id}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <span className="order-drawer-muted font-normal">Courier Status</span>
                      <span className="text-amber-600 dark:text-yellow-400 uppercase">{activeDetailOrder.fulfillments?.[0]?.shipment_status || 'scheduled'}</span>
                    </div>
                    {isAeShippedOrder(activeDetailOrder) && (
                      <div className="pt-2">
                        <AirExpressDocumentsButtons
                          orderIds={[activeDetailOrder.id]}
                          onError={(msg) => triggerNotification('error', msg)}
                          onSuccess={(type) =>
                            triggerNotification(
                              'success',
                              `Air Express ${type === 'labels' ? 'label' : type === 'manifests' ? 'manifest' : 'invoice'} generated`,
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="mt-8 pt-4 border-t order-drawer-divider flex flex-col gap-3 shrink-0">
              {!isOrderCancelled(activeDetailOrder) && (
                <div className="flex gap-2.5">
                  <button
                    onClick={() => handleDeleteOrder(activeDetailOrder.id)}
                    disabled={deletingOrderId === activeDetailOrder.id}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/15 border border-red-500/30 text-xs font-extrabold text-red-600 dark:text-red-400 text-center transition-all active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deletingOrderId === activeDetailOrder.id ? (
                      <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {deletingOrderId === activeDetailOrder.id ? 'Cancelling...' : 'Cancel Order'}
                  </button>

                  <button
                    onClick={() => handleToggleTestOrder(activeDetailOrder)}
                    disabled={togglingTestOrderId === activeDetailOrder.id}
                    className={`flex-1 py-2.5 rounded-xl border text-xs font-extrabold text-center transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                      (activeDetailOrder as any).is_test_order
                        ? 'bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400'
                        : 'bg-purple-500/10 hover:bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-400'
                    }`}
                  >
                    {togglingTestOrderId === activeDetailOrder.id ? (
                      <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {(activeDetailOrder as any).is_test_order ? 'Unmark Test' : 'Mark as Test'}
                  </button>
                </div>
              )}

              {isOrderCancelled(activeDetailOrder) && (
                <button
                  onClick={() => handleToggleTestOrder(activeDetailOrder)}
                  disabled={togglingTestOrderId === activeDetailOrder.id}
                  className={`w-full py-2.5 rounded-xl border text-xs font-extrabold text-center transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                    (activeDetailOrder as any).is_test_order
                      ? 'bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400'
                      : 'bg-purple-500/10 hover:bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-400'
                  }`}
                >
                  {togglingTestOrderId === activeDetailOrder.id ? (
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {(activeDetailOrder as any).is_test_order ? 'Remove Test Order Status' : 'Mark as Test Order'}
                </button>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => router.push(`/orders/${activeDetailOrder.id}`)}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-extrabold text-white text-center transition-all shadow-lg shadow-purple-600/10 active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <Compass className="w-4 h-4" />
                  Open Full Detail Page
                </button>
                <button
                  onClick={() => setActiveDetailOrder(null)}
                  className="flex-1 py-2.5 rounded-xl order-drawer-surface text-xs font-bold hover:opacity-90 transition-all text-center"
                >
                  Close Drawer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function tabName(tab: string): string {
  if (tab === 'new') return 'New Dispatches'
  if (tab === 'confirmed') return 'Confirmed Orders'
  if (tab === 'ready_to_ship') return 'Ready To Ship'
  if (tab === 'pickups_manifests') return 'Pickups & Manifests'
  if (tab === 'in_transit') return 'In Transit'
  if (tab === 'delivered') return 'Delivered'
  if (tab === 'rto') return 'Returned to Origin'
  if (tab === 'cancelled') return 'Cancelled'
  return 'All Orders'
}

function getDeliveryStatusInfo(order: ShopifyOrder) {
  if (isOrderCancelled(order)) {
    return { label: 'Cancelled', variant: 'red' as const }
  }

  const status = normalizeShipmentStatus(order)
  if (!order.fulfillment_status || status === 'unfulfilled') {
    return { label: 'Unfulfilled', variant: 'default' as const }
  }

  const label = fulfillmentStageLabel(status)

  if (status === 'delivered') return { label, variant: 'green' as const }
  if (status === 'rto' || isActiveRtoStatus(order)) return { label: 'RTO Initiated', variant: 'red' as const }
  if (status === 'rto_delivered') return { label, variant: 'red' as const }
  if (status === 'failed' || status === 'failure' || status === 'cancelled') {
    return { label, variant: 'red' as const }
  }
  if (
    status === 'in_transit' ||
    status === 'out_for_delivery' ||
    status === 'attempted_delivery'
  ) {
    return { label, variant: 'yellow' as const }
  }
  if (
    status === 'confirmed' ||
    status === 'pickup_scheduled' ||
    status === 'ready_pickup' ||
    status === 'processing'
  ) {
    return { label, variant: 'blue' as const }
  }

  return { label, variant: 'default' as const }
}
