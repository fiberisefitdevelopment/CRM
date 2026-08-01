/** Helpers to map Shopify + Shiprocket data into a scannable order journey. */

export type TimelineStepKey =
  | 'created'
  | 'payment'
  | 'processing'
  | 'packed'
  | 'ready_pickup'
  | 'picked_up'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'attempt'
  | 'delivered'
  | 'failed'
  | 'rto'
  | 'cancelled'
  | 'refunded'

export interface TimelineStep {
  key: TimelineStepKey
  label: string
  description: string
  timestamp: string | null
  completed: boolean
  current: boolean
  tone: 'neutral' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple'
}

export interface OrderAlert {
  type: string
  label: string
  tone: 'amber' | 'red' | 'emerald'
}

const ACTIVITY_TO_STEP: Record<string, TimelineStepKey> = {
  ORDER_FETCHED: 'created',
  LABEL_GENERATED: 'packed',
  PICKUP_SCHEDULED: 'ready_pickup',
  OUT_FOR_PICKUP: 'ready_pickup',
  PICKED_UP: 'picked_up',
  ORDER_IN_TRANSIT: 'in_transit',
  'REACHED AT DESTINATION HUB': 'in_transit',
  ORDER_OUT_FOR_DELIVERY: 'out_for_delivery',
  ORDER_DELIVERED: 'delivered',
  ORDER_RTO: 'rto',
  RTO_INITIATED: 'rto',
  RTO_DELIVERED: 'rto',
  CANCELLED: 'cancelled',
}

/** Calendar date key in Asia/Kolkata (Shiprocket / India business day). */
export function toIstDateKey(value?: string | null): string {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  // Prefer parseFlexibleDate so DD-MM-YYYY Shiprocket dates are not
  // misread as MM-DD-YYYY in Chrome (Safari often rejects those strings).
  const d = parseFlexibleDate(raw)
  if (d) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return ''
}

/** Order created_at within inclusive YYYY-MM-DD range (IST). Empty bounds = no filter. */
export function isCreatedInDateRange(
  order: any,
  startDate?: string,
  endDate?: string,
): boolean {
  const hasStart = Boolean(startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate))
  const hasEnd = Boolean(endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate))
  if (!hasStart && !hasEnd) return true
  const key = toIstDateKey(order?.created_at)
  if (!key) return true
  if (hasStart && key < startDate!) return false
  if (hasEnd && key > endDate!) return false
  return true
}

/**
 * True when order is in any RTO / failed-return state (including RTO Delivered).
 * Used to keep these out of the Delayed list.
 */
export function hasRtoInitiated(order: any): boolean {
  const status = normalizeShipmentStatus(order)
  if (status === 'rto' || status === 'rto_delivered' || status === 'failed' || status === 'failure') {
    return true
  }

  const shipStatus = String(order?.fulfillments?.[0]?.shipment_status || '').toLowerCase()
  if (['failure', 'rto', 'returned'].includes(shipStatus)) return true

  const meta = order?.shiprocket_meta || {}
  const metaStatus = String(meta.status || meta.current_status || meta.shipment_status || '').toLowerCase()
  return (
    metaStatus.includes('rto') ||
    metaStatus.includes('lost') ||
    metaStatus.includes('untraceable') ||
    metaStatus.includes('return to origin') ||
    metaStatus.includes('returning to seller') ||
    metaStatus.includes('returned to seller')
  )
}

/**
 * Shiprocket Orders → RTO tab + status filter "RTO Initiated".
 * Open returns only (API codes 15 / 55 / 45 / 46):
 *   RTO INITIATED | RTO IN TRANSIT | RTO OFD | RTO NDR
 * Excludes RTO Delivered (16) / RTO Acknowledged (17).
 * Does NOT include LOST / UNTRACEABLE / PICKUP ERROR (those are not RTO Initiated).
 */
export function isActiveRtoStatus(order: any): boolean {
  const metaStatus = String(order?.shiprocket_meta?.status || '').toUpperCase().trim()
  if (metaStatus.includes('RTO')) {
    if (metaStatus.includes('DELIVERED') || metaStatus.includes('ACKNOWLEDG')) return false
    return true
  }

  // Fallback when meta missing: only open RTO (not closed returns)
  const shipStatus = String(order?.fulfillments?.[0]?.shipment_status || '').toLowerCase()
  if (shipStatus === 'rto_delivered' || shipStatus === 'returned') return false
  return shipStatus === 'rto'
}

/**
 * Shiprocket Orders → In Transit tab.
 * Includes en-route / reached hub / shipped / NDR undelivered.
 * Excludes Out for Delivery and any RTO.
 */
export function isShiprocketInTransitStatus(order: any): boolean {
  if (isActiveRtoStatus(order) || normalizeShipmentStatus(order) === 'rto_delivered') return false
  const status = normalizeShipmentStatus(order)
  return status === 'in_transit' || status === 'attempted_delivery'
}

/** Shiprocket Orders → Delivered tab. */
export function isShiprocketDeliveredStatus(order: any): boolean {
  return normalizeShipmentStatus(order) === 'delivered'
}

export function normalizeShipmentStatus(order: any): string {
  const metaStatus = String(order?.shiprocket_meta?.status || '').toLowerCase()
  const shipStatus = String(order?.fulfillments?.[0]?.shipment_status || '').toLowerCase()
  // Match Shiprocket RTO filters:
  // - "RTO Initiated" includes RTO Initiated / In Transit / OFD (active)
  // - "RTO Delivered" / "RTO Acknowledged" are completed returns
  if (metaStatus.includes('rto')) {
    if (metaStatus.includes('delivered') || metaStatus.includes('acknowledged')) {
      return 'rto_delivered'
    }
    return 'rto'
  }
  if (metaStatus.includes('cancel')) return 'cancelled'
  if (metaStatus.includes('lost') || metaStatus.includes('untraceable')) return 'failed'
  if (metaStatus === 'delivered' || metaStatus.startsWith('delivered')) return 'delivered'
  if (metaStatus.includes('out for delivery')) return 'out_for_delivery'
  // In Transit tab: picked up → hub scans → NDR (before RTO)
  if (
    metaStatus.includes('transit') ||
    metaStatus.includes('reached') ||
    metaStatus === 'shipped' ||
    metaStatus.includes('picked up')
  ) {
    return 'in_transit'
  }
  if (metaStatus.includes('undelivered') || metaStatus.includes('attempt')) {
    return 'attempted_delivery'
  }
  // Pickups tab: scheduled / out for pickup / pickup exception — not "picked up"
  if (metaStatus.includes('pickup')) return 'ready_pickup'
  // Enriched shipment_status collapses all RTO stages to "rto" — without raw meta,
  // treat as active so we don't under-count Shiprocket's RTO Initiated list.
  if (shipStatus) return shipStatus
  if (!order?.fulfillment_status) return 'unfulfilled'
  return 'processing'
}

/**
 * Not yet handed to courier / left warehouse:
 * unfulfilled, processing, ready for pickup, confirmed, label printed, etc.
 * Excludes in-transit, OFD, delivered, RTO, failed, cancelled.
 */
export function isNotShippedStatus(order: any): boolean {
  if (order?.cancelled_at) return false
  const financial = String(order?.financial_status || '').toLowerCase()
  if (financial === 'voided' || financial === 'cancelled') return false

  if (isActiveRtoStatus(order) || isShiprocketDeliveredStatus(order) || isShiprocketInTransitStatus(order)) {
    return false
  }

  const status = normalizeShipmentStatus(order)
  if (
    [
      'out_for_delivery',
      'attempted_delivery',
      'rto_delivered',
      'failed',
      'failure',
      'delivered',
      'rto',
      'in_transit',
      'cancelled',
    ].includes(status)
  ) {
    return false
  }

  return true
}

export function paymentLabel(order: any): 'Paid' | 'Pending' | 'Failed' | 'Refunded' {
  const fs = String(order?.financial_status || '').toLowerCase()
  if (fs === 'refunded' || fs === 'voided') return 'Refunded'
  if (fs === 'paid') return 'Paid'
  if (fs === 'pending' || fs === 'authorized' || fs === 'partially_paid') return 'Pending'
  if (fs.includes('fail')) return 'Failed'
  const pm = String(order?.payment_method || '').toLowerCase()
  if (pm.includes('cod')) return 'Pending'
  return fs ? (fs.charAt(0).toUpperCase() + fs.slice(1)) as any : 'Pending'
}

export function buildAlerts(order: any): OrderAlert[] {
  const alerts: OrderAlert[] = []
  const status = normalizeShipmentStatus(order)
  const meta = order?.shiprocket_meta || {}

  if (isOrderDelayed(order)) {
    const days = getDelayDays(order)
    const reason = days > 0
      ? `Delayed by ${days} day${days === 1 ? '' : 's'}`
      : meta.delay_reason
        ? `Delayed: ${meta.delay_reason}`
        : 'Delivery Delayed'
    alerts.push({ type: 'delayed', label: reason, tone: 'red' })
  }
  if (status === 'in_transit' && (meta.delay_reason || meta.delivery_delayed)) {
    alerts.push({ type: 'stuck', label: 'Shipment may be stuck', tone: 'red' })
  }
  if (status === 'rto') {
    alerts.push({ type: 'rto', label: meta.rto_reason ? `RTO: ${meta.rto_reason}` : 'RTO Initiated', tone: 'red' })
  }
  if (status === 'cancelled' || order?.cancelled_at) {
    alerts.push({ type: 'cancelled', label: 'Cancelled Order', tone: 'red' })
  }
  if (String(order?.financial_status || '').toLowerCase() === 'refunded') {
    alerts.push({ type: 'refund', label: 'Refund Completed', tone: 'emerald' })
  }
  if (status === 'attempted_delivery') {
    alerts.push({ type: 'attempted', label: metaStatusAttemptLabel(meta) || 'Delivery Attempt Failed', tone: 'amber' })
  }
  if (status === 'failed') {
    alerts.push({ type: 'failed', label: 'Delivery Attempt Failed', tone: 'red' })
  }
  return alerts
}

function metaStatusAttemptLabel(meta: any): string | null {
  const raw = String(meta?.status || '').trim()
  return raw ? raw.replace(/_/g, ' ') : null
}

/** True when Shiprocket marked delay, or ETD has past and order is still undelivered. */
export function isOrderDelayed(order: any): boolean {
  const status = normalizeShipmentStatus(order)
  // RTO pipeline / cancelled / delivered never belong under Delayed
  if (
    ['delivered', 'cancelled', 'rto', 'rto_delivered', 'failed', 'failure'].includes(status)
  ) {
    return false
  }
  if (order?.cancelled_at) return false
  if (hasRtoInitiated(order) || isActiveRtoStatus(order)) return false

  const meta = order?.shiprocket_meta || {}
  const etd = parseFlexibleDate(meta.etd_date)
  const etdDay = etd ? startOfDay(etd) : null
  const todayDay = startOfDay(new Date())
  const etdPassed = Boolean(etdDay && etdDay.getTime() < todayDay.getTime())
  const etdIsToday = Boolean(etdDay && etdDay.getTime() === todayDay.getTime())

  // Soft Shiprocket flags (delivery_delayed / delay_reason) often stick while a
  // replacement clone is still on track. Only treat as Delayed when ETD is due
  // or past (or there is no ETD to judge against).
  if (meta.delivery_delayed || meta.delay_reason) {
    if (!etdDay || etdPassed || etdIsToday) return true
    return false
  }

  return etdPassed
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Parse Shiprocket / ISO / DD-MM-YYYY style dates. */
export function parseFlexibleDate(value?: string | null): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null

  // Shiprocket uses DD-MM-YYYY (and DD/MM/YYYY). Parse that FIRST.
  // Chrome accepts "02-08-2026" as MM-DD-YYYY (8 Feb) while Safari often rejects it
  // and falls through — which made Delayed / ETD look like rubbish only in Chrome.
  const dmy = raw.match(
    /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3])
    // Prefer DD-MM-YYYY when day > 12, or always for hyphenated Shiprocket dates
    // (Shiprocket list API uses DD-MM-YYYY). Only treat as MM-DD if day<=12 AND
    // month>12 (invalid as DD-MM), which is rare for SR.
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(
        year,
        month - 1,
        day,
        Number(dmy[4] || 0),
        Number(dmy[5] || 0),
        Number(dmy[6] || 0),
      )
      if (!isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
        return d
      }
    }
  }

  // ISO / RFC / unambiguous native parse (e.g. 2026-07-31T11:46:00Z)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) || raw.includes('T') || raw.endsWith('Z')) {
    const iso = new Date(raw)
    if (!isNaN(iso.getTime())) return iso
  }

  const native = new Date(raw)
  if (!isNaN(native.getTime())) return native

  return null
}

/** Best-known shipment / pickup date for an order. */
export function getShipmentDate(order: any): string | null {
  const meta = order?.shiprocket_meta || {}
  const fulfillment = order?.fulfillments?.[0] || {}
  const candidates = [
    meta.picked_up_date,
    meta.pickup_booked_date,
    fulfillment.dispatch_date,
    fulfillment.created_at,
  ]
  for (const c of candidates) {
    if (c && parseFlexibleDate(c)) return String(c)
  }
  return null
}

/**
 * Days past ETD (calendar days). Returns 0 if not delayed / no ETD.
 * Uses today vs ETD for undelivered delayed orders.
 */
export function getDelayDays(order: any): number {
  if (!isOrderDelayed(order)) return 0
  const meta = order?.shiprocket_meta || {}
  const etd = parseFlexibleDate(meta.etd_date)
  if (!etd) return 0
  const etdDay = startOfDay(etd)
  const todayDay = startOfDay(new Date())
  const diff = Math.floor((todayDay.getTime() - etdDay.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(0, diff)
}

export function buildTimeline(order: any, tracking?: any): TimelineStep[] {
  const meta = order?.shiprocket_meta || {}
  const fulfillment = order?.fulfillments?.[0] || {}
  const status = normalizeShipmentStatus(order)
  const activities: string[] = Array.isArray(meta.activities) ? meta.activities : []
  const trackActs: any[] = tracking?.tracking_data?.shipment_track_activities || []

  const findTrackTime = (...labels: string[]) => {
    const hit = trackActs.find((a) => {
      const blob = `${a.activity || ''} ${a['sr-status-label'] || ''} ${a.status || ''}`.toLowerCase()
      return labels.some((l) => blob.includes(l.toLowerCase()))
    })
    return hit?.date || null
  }

  const isCancelled = status === 'cancelled' || !!order?.cancelled_at
  const isRto = status === 'rto' || status === 'rto_delivered'
  const isActiveRto = status === 'rto'
  const isFailed = status === 'failed'
  const isAttempted = status === 'attempted_delivery'
  const isDelivered = status === 'delivered'
  const isOfd = status === 'out_for_delivery'
  const isTransit = status === 'in_transit' || isOfd || isDelivered || isRto || isFailed || isAttempted
  const isPicked = isTransit || activities.includes('PICKED_UP') || !!meta.picked_up_date
  const isReadyPickup =
    isPicked ||
    activities.includes('PICKUP_SCHEDULED') ||
    activities.includes('OUT_FOR_PICKUP') ||
    activities.includes('LABEL_GENERATED') ||
    !!fulfillment.tracking_number
  const isPacked = isReadyPickup || activities.includes('LABEL_GENERATED')
  const isProcessing = !!order?.fulfillment_status || isPacked
  const isPaid =
    String(order?.financial_status || '').toLowerCase() === 'paid' ||
    (String(order?.payment_method || '').toLowerCase().includes('prepaid') && !isCancelled)

  const steps: TimelineStep[] = [
    {
      key: 'created',
      label: 'Order Created',
      description: 'Order placed on storefront / channel',
      timestamp: order?.created_at || null,
      completed: true,
      current: false,
      tone: 'blue',
    },
    {
      key: 'payment',
      label: isPaid ? 'Payment Received' : 'Payment Pending',
      description: isPaid ? 'Payment confirmed' : 'Awaiting payment / COD collection',
      timestamp: isPaid ? order?.created_at || null : null,
      completed: isPaid || isDelivered,
      current: !isPaid && !isCancelled && !isDelivered,
      tone: isPaid || isDelivered ? 'emerald' : 'amber',
    },
    {
      key: 'processing',
      label: 'Processing',
      description: 'Order accepted for fulfillment',
      timestamp: order?.created_at || null,
      completed: isProcessing || isPacked || isReadyPickup || isPicked || isTransit || isDelivered,
      current: !isProcessing && !isCancelled,
      tone: 'purple',
    },
    {
      key: 'packed',
      label: 'Packed',
      description: 'Label generated / package prepared',
      timestamp: findTrackTime('label', 'data received') || (activities.includes('LABEL_GENERATED') ? meta.pickup_booked_date || order?.created_at : null),
      completed: isPacked || isReadyPickup || isPicked || isTransit || isDelivered,
      current: isProcessing && !isPacked && !isCancelled,
      tone: 'purple',
    },
    {
      key: 'ready_pickup',
      label: 'Ready for Pickup',
      description: 'Awaiting courier pickup',
      timestamp: meta.pickup_booked_date || findTrackTime('out for pickup', 'pickup scheduled'),
      completed: isReadyPickup || isPicked || isTransit || isDelivered,
      current: isPacked && !isPicked && !isCancelled && !isRto,
      tone: 'amber',
    },
    {
      key: 'picked_up',
      label: 'Pickup Completed',
      description: 'Courier collected the shipment',
      timestamp: meta.picked_up_date || findTrackTime('pickup done', 'picked up'),
      completed: isPicked || isTransit || isDelivered,
      current: isReadyPickup && !isPicked && !isCancelled,
      tone: 'blue',
    },
    {
      key: 'dispatched',
      label: 'Dispatched',
      description: 'Shipment left origin hub',
      timestamp: fulfillment.dispatch_date || meta.picked_up_date || findTrackTime('in transit'),
      completed: isTransit || isDelivered,
      current: isPicked && !isTransit && !isCancelled,
      tone: 'blue',
    },
    {
      key: 'in_transit',
      label: 'In Transit',
      description: 'Moving through courier network',
      timestamp: findTrackTime('in transit', 'reached at destination'),
      completed: isTransit || isDelivered,
      current: status === 'in_transit',
      tone: 'blue',
    },
    {
      key: 'out_for_delivery',
      label: 'Out for Delivery',
      description: 'With delivery executive',
      timestamp: meta.out_for_delivery_date || findTrackTime('out for delivery'),
      completed: isOfd || isDelivered || isFailed || isRto,
      current: isOfd,
      tone: 'amber',
    },
    {
      key: 'delivered',
      label: 'Delivered',
      description: 'Successfully delivered to customer',
      timestamp: meta.delivered_date || fulfillment.delivery_date || findTrackTime('delivered'),
      completed: isDelivered,
      current: isDelivered,
      tone: 'emerald',
    },
    {
      key: 'failed',
      label: 'Delivery Attempt Failed',
      description: 'Courier could not complete delivery',
      timestamp: findTrackTime('undelivered', 'failed', 'attempt'),
      completed: isFailed || isAttempted,
      current: isFailed || isAttempted,
      tone: 'red',
    },
    {
      key: 'rto',
      label: 'Returned to Origin (RTO)',
      description: meta.rto_reason || 'Shipment returning / returned to warehouse',
      timestamp: findTrackTime('rto') || (isRto ? meta.delivered_date || order?.updated_at : null),
      completed: isRto,
      current: isActiveRto,
      tone: 'red',
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      description: 'Order cancelled',
      timestamp: order?.cancelled_at || null,
      completed: isCancelled,
      current: isCancelled,
      tone: 'red',
    },
    {
      key: 'refunded',
      label: 'Refunded',
      description: 'Refund completed',
      timestamp: String(order?.financial_status || '').toLowerCase() === 'refunded' ? order?.updated_at || order?.cancelled_at : null,
      completed: String(order?.financial_status || '').toLowerCase() === 'refunded',
      current: String(order?.financial_status || '').toLowerCase() === 'refunded',
      tone: 'emerald',
    },
  ]

  // Mark a single current step when none set
  if (!steps.some((s) => s.current)) {
    const lastDone = [...steps].reverse().find((s) => s.completed)
    if (lastDone && !['delivered', 'rto', 'cancelled', 'refunded', 'failed'].includes(lastDone.key)) {
      const idx = steps.findIndex((s) => s.key === lastDone.key)
      if (idx >= 0 && idx < steps.length - 1) steps[idx].current = true
    }
  }

  // Hide terminal-negative steps unless relevant
  return steps.filter((s) => {
    if (s.key === 'failed') return isFailed || isAttempted || s.completed
    if (s.key === 'rto') return isRto || s.completed
    if (s.key === 'cancelled') return isCancelled || s.completed
    if (s.key === 'refunded') return s.completed
    return true
  })
}

export function fulfillmentStageLabel(status: string): string {
  const map: Record<string, string> = {
    unfulfilled: 'Order Created',
    processing: 'Processing',
    packed: 'Packed',
    ready_pickup: 'Ready for Pickup',
    pickup_scheduled: 'Ready for Pickup',
    picked_up: 'Pickup Completed',
    dispatched: 'Dispatched',
    in_transit: 'In Transit',
    out_for_delivery: 'Out for Delivery',
    attempted_delivery: 'Undelivered / Attempted',
    delivered: 'Delivered',
    failed: 'Delivery Attempt Failed',
    failure: 'Delivery Attempt Failed',
    rto: 'RTO Initiated',
    rto_delivered: 'RTO Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  }
  return map[status] || status.replace(/_/g, ' ')
}

export function mapActivityToLabel(activity: string): string {
  const key = ACTIVITY_TO_STEP[activity]
  if (!key) return activity.replace(/_/g, ' ')
  const labels: Record<string, string> = {
    created: 'Order Created',
    packed: 'Packed / Label Generated',
    ready_pickup: 'Ready for Pickup',
    picked_up: 'Picked Up',
    in_transit: 'In Transit',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    rto: 'RTO',
    cancelled: 'Cancelled',
  }
  return labels[key] || activity
}
