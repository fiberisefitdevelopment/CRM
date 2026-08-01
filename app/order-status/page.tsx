'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  PackageSearch,
  Phone,
  RefreshCw,
  Search,
  StickyNote,
  Truck,
  User,
  X,
  XCircle,
  CalendarDays,
} from 'lucide-react'
import { getPaymentLabel, isCodOrder } from '@/src/utils/orderPayment'
import {
  buildAlerts,
  buildTimeline,
  fulfillmentStageLabel,
  getDelayDays,
  getShipmentDate,
  hasRtoInitiated,
  isActiveRtoStatus,
  isCreatedInDateRange,
  isNotShippedStatus,
  isOrderDelayed,
  isShiprocketDeliveredStatus,
  isShiprocketInTransitStatus,
  normalizeShipmentStatus,
  parseFlexibleDate,
  paymentLabel,
  toIstDateKey,
  type TimelineStep,
} from '@/src/utils/orderTimeline'
import { CareOrderTagBadge } from '@/components/orders/CareOrderTagBadge'
import type { CareOrderTagEntry } from '@/src/utils/careOrderTags'

/** Default Order Status window: last 30 calendar days in IST (inclusive). */
function getDefaultDateRange(): { start: string; end: string } {
  const end = toIstDateKey(new Date().toISOString())
  const startMs = Date.now() - 29 * 24 * 60 * 60 * 1000
  const start = toIstDateKey(new Date(startMs).toISOString())
  return { start, end }
}

interface OrderRow {
  id: number
  name: string
  created_at: string
  financial_status: string
  payment_method?: string | null
  fulfillment_status: string | null
  total_price: string
  cancelled_at?: string | null
  care_tag?: CareOrderTagEntry | null
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string } | null
  shipping_address?: {
    first_name?: string
    last_name?: string
    phone?: string
    city?: string
    province?: string
    zip?: string
  } | null
  fulfillments?: Array<{
    tracking_number?: string | null
    tracking_company?: string | null
    tracking_url?: string | null
    shipment_status?: string | null
    shipment_status_reason?: string | null
    created_at?: string
    dispatch_date?: string | null
    delivery_date?: string | null
  }>
  shiprocket_meta?: any
  source?: string
  note?: string | null
}

function fmtWhen(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value)
  if (!d) return String(value)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDay(value?: string | null) {
  if (!value) return '—'
  const d = parseFlexibleDate(value)
  if (!d) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function orderValue(order: OrderRow | any): number {
  const n = parseFloat(String(order?.total_price ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Compact INR for summary cards (e.g. ₹10.2L, ₹1.05Cr, ₹12,450). */
function fmtInrCompact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_00_00_000) {
    return `${sign}₹${(abs / 1_00_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}Cr`
  }
  if (abs >= 1_00_000) {
    return `${sign}₹${(abs / 1_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}L`
  }
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function customerName(o: OrderRow) {
  const c = o.customer
  const name = `${c?.first_name || ''} ${c?.last_name || ''}`.trim()
  if (name) return name
  const s = o.shipping_address
  return `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || 'Guest'
}

function customerPhone(o: OrderRow) {
  return o.customer?.phone || o.shipping_address?.phone || '—'
}

/** Strip leading # and lowercase for clone/parent matching. */
function cleanOrderName(name?: string | null): string {
  return String(name || '').replace(/^#/, '').trim().toLowerCase()
}

/** True when order name follows clone convention: `{parent}-C`. */
function isCloneOrderName(name?: string | null): boolean {
  return cleanOrderName(name).endsWith('-c')
}

/** Parent base name for a clone (`1128-c` → `1128`). Null if not a clone. */
function getCloneParentBase(name?: string | null): string | null {
  const clean = cleanOrderName(name)
  if (!clean.endsWith('-c')) return null
  return clean.slice(0, -2)
}

/** Most recent clone in a trail (list should already be created_at ascending). */
function getLatestClone(clones: OrderRow[]): OrderRow | null {
  if (!clones.length) return null
  return clones[clones.length - 1]
}

/**
 * When a clone exists, ops status (delayed / delivered / in transit) follows the clone.
 * Original order stays the list row; clone is the live shipment.
 */
function getOperationalOrder(order: OrderRow, relatedClones: OrderRow[] = []): OrderRow {
  return getLatestClone(relatedClones) || order
}

/** Cancelled / voided order (Shopify or Shiprocket). */
function isCancelledOrder(order: OrderRow | any): boolean {
  if (!order) return false
  if (order.cancelled_at) return true
  const financial = String(order.financial_status || '').toLowerCase()
  if (financial === 'voided' || financial === 'cancelled') return true
  const status = normalizeShipmentStatus(order)
  return status === 'cancelled'
}

function badgeTone(tone: string) {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/25'
    case 'amber':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/25'
    case 'red':
      return 'bg-red-500/15 text-red-600 border-red-500/25'
    case 'blue':
      return 'bg-blue-500/15 text-blue-600 border-blue-500/25'
    case 'purple':
      return 'bg-purple-500/15 text-purple-600 border-purple-500/25'
    default:
      return 'bg-black/5 text-[var(--foreground-muted)] border-[var(--border)]'
  }
}

function statusTone(status: string): string {
  if (status === 'delivered') return 'emerald'
  if (status === 'rto' || status === 'rto_delivered' || status === 'failed' || status === 'cancelled') return 'red'
  if (
    status === 'out_for_delivery' ||
    status === 'ready_pickup' ||
    status === 'pickup_scheduled' ||
    status === 'attempted_delivery'
  ) {
    return 'amber'
  }
  if (status === 'in_transit' || status === 'dispatched') return 'blue'
  return 'purple'
}

function TimelineRail({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="relative pl-2">
      <div className="absolute left-[15px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />
      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="relative flex gap-3">
            <div
              className={`relative z-10 mt-0.5 w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${
                step.completed
                  ? badgeTone(step.tone)
                  : 'bg-[var(--card)] border-[var(--border)] text-[var(--foreground-muted)]'
              }`}
            >
              {step.completed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  {step.label}
                </p>
                {step.current && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-600 border-purple-500/20">
                    Current
                  </span>
                )}
                <span className="text-[10px] font-medium" style={{ color: 'var(--foreground-muted)' }}>
                  {step.completed ? 'Completed' : 'Pending'}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                {step.description}
              </p>
              <p className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>
                {fmtWhen(step.timestamp)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OrderStatusCard({
  order,
  expanded,
  onToggle,
  onNoteSaved,
  relatedClones = [],
  parentOrder = null,
  onOpenRelated,
}: {
  order: OrderRow
  expanded: boolean
  onToggle: () => void
  onNoteSaved: (orderId: number, note: string) => void
  relatedClones?: OrderRow[]
  parentOrder?: OrderRow | null
  onOpenRelated?: (orderId: number) => void
}) {
  const router = useRouter()
  const [tracking, setTracking] = useState<any>(null)
  const [trackLoading, setTrackLoading] = useState(false)
  const [trackError, setTrackError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(order.note || '')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const fulfillment = order.fulfillments?.[0]
  const awb = fulfillment?.tracking_number || ''
  const status = normalizeShipmentStatus(order)
  const delayed = isOrderDelayed(order)
  const alerts = buildAlerts(order)
  const meta = order.shiprocket_meta || {}
  const shipmentDate = getShipmentDate(order)
  const delayDays = getDelayDays(order)
  const isClone = isCloneOrderName(order.name)
  const hasClones = relatedClones.length > 0
  const operational = getOperationalOrder(order, relatedClones)
  const usingClone = hasClones && operational.id !== order.id
  const opFulfillment = operational.fulfillments?.[0]
  const opAwb = opFulfillment?.tracking_number || ''
  const opStatus = normalizeShipmentStatus(operational)
  const opDelayed = isOrderDelayed(operational)
  const opMeta = operational.shiprocket_meta || {}
  const opShipmentDate = getShipmentDate(operational)
  const opDelayDays = getDelayDays(operational)
  // Card “live” view follows clone when present
  const liveStatus = usingClone ? opStatus : status
  const liveDelayed = usingClone ? opDelayed : delayed
  const liveAwb = usingClone ? opAwb : awb
  const liveFulfillment = usingClone ? opFulfillment : fulfillment
  const liveMeta = usingClone ? opMeta : meta
  const liveShipmentDate = usingClone ? opShipmentDate : shipmentDate
  const liveDelayDays = usingClone ? opDelayDays : delayDays
  const liveAlerts = usingClone ? buildAlerts(operational) : alerts
  const timeline = useMemo(
    () => buildTimeline(usingClone ? operational : order, tracking),
    [order, operational, usingClone, tracking],
  )

  useEffect(() => {
    setNoteDraft(order.note || '')
  }, [order.note])

  useEffect(() => {
    setTracking(null)
    setTrackError(null)
  }, [order.id, liveAwb])

  useEffect(() => {
    if (!expanded || !liveAwb || tracking) return
    let cancelled = false
    ;(async () => {
      try {
        setTrackLoading(true)
        setTrackError(null)
        const res = await fetch(`/api/order-status/track?awb=${encodeURIComponent(liveAwb)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load tracking')
        if (!cancelled) setTracking(data)
      } catch (err: any) {
        if (!cancelled) setTrackError(err.message || 'Tracking unavailable')
      } finally {
        if (!cancelled) setTrackLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [expanded, liveAwb, tracking])

  const saveNote = async () => {
    try {
      setNoteSaving(true)
      setNoteError(null)
      const res = await fetch(`/api/shopify/orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteDraft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save note')
      onNoteSaved(order.id, data.note || noteDraft.trim())
      setNoteOpen(false)
    } catch (err: any) {
      setNoteError(err.message || 'Failed to save note')
    } finally {
      setNoteSaving(false)
    }
  }

  const trackInfo = tracking?.tracking_data?.shipment_track?.[0]
  const trackActs: any[] = tracking?.tracking_data?.shipment_track_activities || []
  const npr = tracking?.tracking_data?.npr
  const failedAttempts = trackActs.filter((a) => {
    const blob = `${a.activity || ''} ${a['sr-status-label'] || ''}`.toLowerCase()
    return blob.includes('undelivered') || blob.includes('failed') || blob.includes('attempt') || blob.includes('exception')
  })

  const pay = paymentLabel(order)
  const payMethod = getPaymentLabel(order)

  return (
    <div
      className={`crm-card overflow-hidden border ${
        liveDelayed ? 'ring-1 ring-red-500/40' : hasClones || isClone ? 'ring-1 ring-emerald-500/35' : ''
      }`}
      style={{
        borderColor: liveDelayed
          ? 'rgba(239, 68, 68, 0.5)'
          : hasClones || isClone
            ? 'rgba(16, 185, 129, 0.45)'
            : 'var(--border)',
      }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left p-4 lg:p-5 pr-24 hover:bg-purple-500/[0.03] transition-colors"
        >
        <div className="flex items-start gap-3">
          <div className="mt-1 text-[var(--foreground-muted)]">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap" style={{ color: 'var(--foreground-muted)' }}>
                Order
                {liveDelayed && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('red')}`}>
                    Delayed
                  </span>
                )}
                {isCancelledOrder(usingClone ? operational : order) && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('amber')}`}>
                    Cancelled
                  </span>
                )}
                {order.source === 'shiprocket' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('purple')}`}>
                    Shiprocket
                  </span>
                )}
                {hasClones && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('emerald')}`}>
                    {relatedClones.length} clone{relatedClones.length === 1 ? '' : 's'}
                  </span>
                )}
                {isClone && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('emerald')}`}>
                    Clone{parentOrder ? ` of ${parentOrder.name}` : ''}
                  </span>
                )}
                <CareOrderTagBadge tag={(order as OrderRow).care_tag} />
              </p>
              <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                {order.name}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                ID {order.id} · {fmtWhen(order.created_at)}
              </p>
              {usingClone && (
                <p className="text-[11px] mt-0.5 font-semibold text-emerald-600">
                  Active: {operational.name}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                Customer
              </p>
              <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--foreground)' }}>
                <User className="w-3.5 h-3.5 opacity-60" />
                {customerName(order)}
              </p>
              <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--foreground-muted)' }}>
                <Phone className="w-3 h-3" /> {customerPhone(order)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                Payment
              </p>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone(pay === 'Paid' ? 'emerald' : pay === 'Pending' ? 'amber' : 'red')}`}>
                  {pay}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone(isCodOrder(order) ? 'amber' : 'emerald')}`}>
                  {payMethod}
                </span>
              </div>
              <p className="text-sm font-bold mt-1" style={{ color: 'var(--foreground)' }}>
                ₹{order.total_price}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                Fulfillment{usingClone ? ' (clone)' : ''}
              </p>
              <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded border mt-0.5 ${badgeTone(statusTone(liveStatus))}`}>
                {fulfillmentStageLabel(liveStatus)}
              </span>
              <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--foreground-muted)' }}>
                {liveFulfillment?.tracking_company || 'No courier yet'}
                {liveAwb ? ` · ${liveAwb}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Always-visible shipment + delay summary (no expand needed) */}
        <div
          className="mt-3 ml-7 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]"
          style={{ color: 'var(--foreground-muted)' }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 opacity-70" />
            <span className="font-semibold" style={{ color: 'var(--foreground)' }}>Shipped</span>
            {fmtDay(liveShipmentDate)}
          </span>
          {liveMeta.etd_date && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 opacity-70" />
              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>ETD</span>
              {fmtDay(liveMeta.etd_date)}
            </span>
          )}
          {liveDelayed && (
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('red')}`}>
              <AlertCircle className="w-3 h-3" />
              {liveDelayDays > 0
                ? `Delayed by ${liveDelayDays} day${liveDelayDays === 1 ? '' : 's'}`
                : 'Delayed (ETD today / flagged)'}
            </span>
          )}
        </div>

        {liveAlerts.length > 0 && (
          <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
            {liveAlerts
              .filter((a) => a.type !== 'delayed') // delay days shown above
              .map((a) => (
              <span key={a.type + a.label} className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone(a.tone)}`}>
                {a.label}
              </span>
            ))}
          </div>
        )}
        {order.note && (
          <p className="mt-2 ml-7 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
            <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-500" />
            <span className="line-clamp-2">{order.note}</span>
          </p>
        )}
        {hasClones && !expanded && (
          <p className="mt-2 ml-7 text-[11px] text-emerald-600 font-medium">
            Clone trail:{' '}
            <span className="font-semibold">
              {relatedClones.map((c) => c.name).join(', ')}
            </span>
            {' '}· expand for details
          </p>
        )}
      </button>

        {/* Action buttons — do not expand the card */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
          <button
            type="button"
            title="Add note"
            onClick={(e) => {
              e.stopPropagation()
              setNoteDraft(order.note || '')
              setNoteError(null)
              setNoteOpen(true)
            }}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border bg-[var(--card)] hover:bg-purple-500/10 hover:border-purple-500/40 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          >
            <StickyNote className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Open full order details"
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/orders/${order.id}`)
            }}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border bg-[var(--card)] hover:bg-purple-500/10 hover:border-purple-500/40 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {noteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !noteSaving && setNoteOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                  Add note · {order.name}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                  Saved in CRM{order.source === 'shiprocket' ? '' : ' and synced to Shopify'}
                </p>
              </div>
              <button
                type="button"
                disabled={noteSaving}
                onClick={() => setNoteOpen(false)}
                className="p-1.5 rounded-lg hover:bg-black/5"
                style={{ color: 'var(--foreground-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={5}
              placeholder="e.g. Customer asked to hold delivery, call before OFD…"
              className="w-full px-3 py-2.5 rounded-xl border text-sm resize-y focus:outline-none focus:border-purple-500/50"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              autoFocus
            />
            {noteError && (
              <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {noteError}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={noteSaving}
                onClick={() => setNoteOpen(false)}
                className="px-3 py-2 rounded-xl border text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={noteSaving}
                onClick={saveNote}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
              >
                {noteSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StickyNote className="w-3.5 h-3.5" />}
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t px-4 lg:px-5 py-5 space-y-6" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Timeline */}
            <section>
              <h3 className="text-xs font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--foreground-muted)' }}>
                Order Timeline
              </h3>
              <TimelineRail steps={timeline} />
            </section>

            {/* Shipping + Delivery */}
            <section className="space-y-4">
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                <h3 className="text-xs font-extrabold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                  <Truck className="w-3.5 h-3.5" /> Shipping Information
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {[
                    ['Courier Partner', liveFulfillment?.tracking_company || '—'],
                    ['Tracking Number', liveAwb || '—'],
                    ['Warehouse', liveMeta.pickup_location || '—'],
                    ['Shipping Method', liveMeta.shipping_method || '—'],
                    ['Estimated Delivery', fmtWhen(liveMeta.etd_date || tracking?.tracking_data?.etd)],
                    ['Actual Delivery', fmtWhen(liveMeta.delivered_date || liveFulfillment?.delivery_date)],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dt className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>{k}</dt>
                      <dd className="font-semibold break-all" style={{ color: 'var(--foreground)' }}>{v as string}</dd>
                    </div>
                  ))}
                </dl>
                {(liveFulfillment?.tracking_url || tracking?.tracking_data?.track_url) && (
                  <a
                    href={liveFulfillment?.tracking_url || tracking?.tracking_data?.track_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-purple-600 hover:underline"
                  >
                    Open Tracking URL <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                <h3 className="text-xs font-extrabold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                  <MapPin className="w-3.5 h-3.5" /> Delivery Information
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {[
                    ['Current Status', fulfillmentStageLabel(liveStatus)],
                    ['Delivered', liveStatus === 'delivered' ? 'Yes' : 'No'],
                    ['Dispatched', liveAwb || liveMeta.picked_up_date ? 'Yes' : 'No'],
                    ['Recipient', trackInfo?.consignee_name || customerName(order)],
                    ['Delivery Proof', trackInfo?.pod || trackInfo?.pod_status || '—'],
                    ['Delivery Notes', liveFulfillment?.shipment_status_reason || liveMeta.delay_reason || '—'],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dt className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>{k}</dt>
                      <dd className="font-semibold break-words" style={{ color: 'var(--foreground)' }}>{v as string}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          </div>

          {/* Attempts + Calls + Live track */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
              <h3 className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Delivery Attempts
              </h3>
              <div className="flex gap-3 text-sm mb-3">
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--foreground-muted)' }}>Total</p>
                  <p className="font-extrabold" style={{ color: 'var(--foreground)' }}>{npr?.attempts ?? failedAttempts.length}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--foreground-muted)' }}>Successful</p>
                  <p className="font-extrabold text-emerald-600">{liveStatus === 'delivered' ? 1 : 0}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--foreground-muted)' }}>Failed</p>
                  <p className="font-extrabold text-red-600">{failedAttempts.length || npr?.attempts || 0}</p>
                </div>
              </div>
              {failedAttempts.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>No failed attempts recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {failedAttempts.map((a, i) => (
                    <li key={i} className="text-xs rounded-lg border p-2" style={{ borderColor: 'var(--border)' }}>
                      <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{a.activity || a['sr-status-label']}</p>
                      <p style={{ color: 'var(--foreground-muted)' }}>{fmtWhen(a.date)} · {a.location || '—'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
              <h3 className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Customer Call History
              </h3>
              {liveMeta.has_calls ? (
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  Delivery partner call activity flagged on this shipment. Detailed call logs are not exposed by the courier list API.
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                  No delivery-partner call records available for this order.
                </p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[['Total', '—'], ['Answered', '—'], ['Missed', '—']].map(([l, v]) => (
                  <div key={l} className="rounded-lg border py-2" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>{l}</p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
              <h3 className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Live Courier Trail
              </h3>
              {trackLoading && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching AWB updates…
                </p>
              )}
              {trackError && (
                <p className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {trackError}</p>
              )}
              {!liveAwb && <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>No AWB assigned yet.</p>}
              {liveAwb && !trackLoading && trackActs.length === 0 && !trackError && (
                <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>No scan events yet.</p>
              )}
              {trackActs.length > 0 && (
                <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {trackActs.slice(0, 12).map((a, i) => (
                    <li key={i} className="text-xs border-l-2 pl-2" style={{ borderColor: 'var(--border)' }}>
                      <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{a.activity || a['sr-status-label']}</p>
                      <p style={{ color: 'var(--foreground-muted)' }}>{fmtWhen(a.date)} · {a.location || '—'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Clone order trail (parent) / parent link (clone) */}
          {(hasClones || (isClone && parentOrder)) && (
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
              <h3 className="text-xs font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--foreground-muted)' }}>
                {hasClones ? 'Clone Order Trail' : 'Original Order'}
              </h3>
              {isClone && parentOrder && (
                <button
                  type="button"
                  onClick={() => onOpenRelated?.(parentOrder.id)}
                  className="w-full text-left rounded-lg border p-3 mb-2 hover:bg-purple-500/[0.04] transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                        {parentOrder.name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                        Parent · {fulfillmentStageLabel(normalizeShipmentStatus(parentOrder))}
                        {parentOrder.fulfillments?.[0]?.tracking_number
                          ? ` · ${parentOrder.fulfillments[0].tracking_number}`
                          : ''}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 opacity-50" />
                  </div>
                </button>
              )}
              {hasClones && (
                <ul className="space-y-2">
                  <li className="rounded-lg border p-3 opacity-80" style={{ borderColor: 'var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>
                      Original
                    </p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                      {order.name}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                      {fulfillmentStageLabel(status)}
                      {awb ? ` · ${awb}` : ''}
                      {fulfillment?.tracking_company ? ` · ${fulfillment.tracking_company}` : ''}
                    </p>
                  </li>
                  {relatedClones.map((clone, idx) => {
                    const cStatus = normalizeShipmentStatus(clone)
                    const cAwb = clone.fulfillments?.[0]?.tracking_number || ''
                    const cCourier = clone.fulfillments?.[0]?.tracking_company || ''
                    return (
                      <li key={clone.id}>
                        <button
                          type="button"
                          onClick={() => onOpenRelated?.(clone.id)}
                          className="w-full text-left rounded-lg border p-3 hover:bg-emerald-500/[0.06] transition-colors"
                          style={{ borderColor: 'rgba(16, 185, 129, 0.4)' }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-emerald-600">
                                Clone {relatedClones.length > 1 ? idx + 1 : ''}
                                {idx === relatedClones.length - 1 ? ' · active' : ''}
                              </p>
                              <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                                {clone.name}
                              </p>
                              <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                Created {fmtWhen(clone.created_at)}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone(statusTone(cStatus))}`}>
                                  {fulfillmentStageLabel(cStatus)}
                                </span>
                                {(cCourier || cAwb) && (
                                  <span className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                                    {cCourier || 'Courier'}{cAwb ? ` · ${cAwb}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 opacity-50 mt-1 shrink-0" />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Fulfillment checklist */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
            <h3 className="text-xs font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--foreground-muted)' }}>
              Fulfillment Status Checklist
            </h3>
            <div className="flex flex-wrap gap-2">
              {timeline.map((s) => (
                <span
                  key={s.key}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                    s.completed ? badgeTone(s.tone) : 'opacity-50 border-[var(--border)] text-[var(--foreground-muted)]'
                  }`}
                  title={fmtWhen(s.timestamp)}
                >
                  {s.completed ? '✓ ' : '○ '}
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

type OrderStatusSummary = {
  total: number
  delivered: number
  inTransit: number
  delayed: number
  rto: number
  cancelled: number
  notShipped: number
  values: {
    total: number
    delivered: number
    inTransit: number
    delayed: number
    rto: number
    cancelled: number
    notShipped: number
  }
}

type OrderStatusRow = OrderRow & {
  _related_clones?: OrderRow[]
  _parent?: OrderRow | null
}

export default function OrderStatusPage() {
  const [orders, setOrders] = useState<OrderStatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [couriers, setCouriers] = useState<string[]>([])
  const [channelBreakdown, setChannelBreakdown] = useState({ shopify: 0, shiprocket: 0 })
  const [summary, setSummary] = useState<OrderStatusSummary>({
    total: 0,
    delivered: 0,
    inTransit: 0,
    delayed: 0,
    rto: 0,
    cancelled: 0,
    notShipped: 0,
    values: {
      total: 0,
      delivered: 0,
      inTransit: 0,
      delayed: 0,
      rto: 0,
      cancelled: 0,
      notShipped: 0,
    },
  })

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // Default "all" so CUSTOM / Shiprocket-only orders match Shiprocket dashboard counts
  const [channel, setChannel] = useState<'shopify' | 'shiprocket' | 'all'>('all')
  const [courier, setCourier] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all')
  const [deliveryStatus, setDeliveryStatus] = useState('all')
  const [startDate, setStartDate] = useState(() => getDefaultDateRange().start)
  const [endDate, setEndDate] = useState(() => getDefaultDateRange().end)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const loadOrders = useCallback(
    async (force = false) => {
      try {
        if (force) setRefreshing(true)
        else setLoading(true)
        setError(null)
        setOrders([])

        const params = new URLSearchParams({
          view: 'order_status',
          page: String(page),
          per_page: String(pageSize),
          include_test: 'true',
        })
        if (force) params.set('refresh', 'true')
        if (debouncedSearch) params.set('search', debouncedSearch)
        if (channel !== 'all') params.set('channel', channel)
        if (courier !== 'all') params.set('courier', courier)
        if (paymentStatus !== 'all') params.set('payment_status', paymentStatus)
        if (fulfillmentStatus !== 'all') params.set('fulfillment', fulfillmentStatus)
        if (deliveryStatus !== 'all') params.set('delivery', deliveryStatus)
        if (startDate) params.set('start_date', startDate)
        if (endDate) params.set('end_date', endDate)

        const res = await fetch(`/api/shopify/orders?${params.toString()}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to load orders')

        // Cold start: keep polling until cache is seeded
        if (data.syncing && (!data.orders || data.orders.length === 0)) {
          setLoading(true)
          setTimeout(() => loadOrders(false), 1500)
          return
        }

        setOrders(Array.isArray(data.orders) ? data.orders : [])
        const pag = data.pagination || {}
        setTotal(Number(pag.total || 0))
        setTotalPages(Math.max(1, Number(pag.total_pages || 1)))
        if (pag.page && Number(pag.page) !== page) setPage(Number(pag.page))
        if (data.summary) setSummary(data.summary)
        if (Array.isArray(data.couriers)) setCouriers(data.couriers)
        if (data.channelBreakdown) setChannelBreakdown(data.channelBreakdown)
        setLastSynced(new Date())
        setLoading(false)
        setRefreshing(false)
      } catch (err: any) {
        setError(err.message || 'Failed to load order status')
        setLoading(false)
        setRefreshing(false)
      }
    },
    [
      page,
      pageSize,
      debouncedSearch,
      channel,
      courier,
      paymentStatus,
      fulfillmentStatus,
      deliveryStatus,
      startDate,
      endDate,
    ],
  )

  useEffect(() => {
    loadOrders(false)
  }, [loadOrders])

  const clearFilters = () => {
    const defaults = getDefaultDateRange()
    setSearch('')
    setDebouncedSearch('')
    setChannel('all')
    setCourier('all')
    setPaymentStatus('all')
    setFulfillmentStatus('all')
    setDeliveryStatus('all')
    setStartDate(defaults.start)
    setEndDate(defaults.end)
    setPage(1)
  }

  const getRelatedClones = useCallback(
    (o: OrderStatusRow) => o._related_clones || [],
    [],
  )

  const defaultDates = useMemo(() => getDefaultDateRange(), [])
  const isLast30Days =
    Boolean(startDate) &&
    Boolean(endDate) &&
    startDate === defaultDates.start &&
    endDate === defaultDates.end
  const filtersActive =
    search.trim() !== '' ||
    channel !== 'all' ||
    courier !== 'all' ||
    paymentStatus !== 'all' ||
    fulfillmentStatus !== 'all' ||
    deliveryStatus !== 'all' ||
    !isLast30Days

  const openRelatedOrder = useCallback(
    (orderId: number) => {
      const onPage = orders.find((o) => o.id === orderId)
      if (onPage) {
        setExpandedId(orderId)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            document.getElementById(`order-card-${orderId}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }, 50)
        }
        return
      }
      // Clone may be folded under a parent on this page
      const parentOnPage = orders.find((o) =>
        (o._related_clones || []).some((c) => c.id === orderId),
      )
      if (parentOnPage) {
        setExpandedId(parentOnPage.id)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            document.getElementById(`order-card-${parentOnPage.id}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }, 50)
        }
        return
      }
      window.location.href = `/orders/${orderId}`
    },
    [orders],
  )

  const toggleQuickFilter = (key: string) => {
    setDeliveryStatus((s) => (s === key ? 'all' : key))
    setPage(1)
    setExpandedId(null)
  }

  const ringFor = (key: string, tone: string) => {
    const active = deliveryStatus === key
    const map: Record<string, string> = {
      red: active ? 'ring-2 ring-red-500/50' : 'hover:ring-2 hover:ring-red-500/40',
      emerald: active ? 'ring-2 ring-emerald-500/50' : 'hover:ring-2 hover:ring-emerald-500/40',
      blue: active ? 'ring-2 ring-blue-500/50' : 'hover:ring-2 hover:ring-blue-500/40',
      purple: active ? 'ring-2 ring-purple-500/50' : 'hover:ring-2 hover:ring-purple-500/40',
      amber: active ? 'ring-2 ring-amber-500/50' : 'hover:ring-2 hover:ring-amber-500/40',
      slate: active ? 'ring-2 ring-slate-500/50' : 'hover:ring-2 hover:ring-slate-500/40',
    }
    return map[tone] || map.purple
  }

  const safePage = Math.min(page, totalPages)
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize
  const pageOrders = orders

  // Reset to page 1 whenever filters / page size change
  useEffect(() => {
    setPage(1)
    setExpandedId(null)
  }, [
    debouncedSearch,
    channel,
    courier,
    paymentStatus,
    fulfillmentStatus,
    deliveryStatus,
    startDate,
    endDate,
    pageSize,
  ])

  const goToPage = (next: number) => {
    setExpandedId(null)
    setPage(Math.min(Math.max(1, next), totalPages))
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold badge-purple">Order Journey</span>
                {lastSynced && (
                  <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Last synced {fmtWhen(lastSynced.toISOString())}
                  </span>
                )}
              </div>
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
                <PackageSearch className="w-7 h-7 text-purple-500" />
                Order Status
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
                End-to-end timeline for every Shopify / Shiprocket order — from creation to delivery.
              </p>
            </div>
            <button
              onClick={() => loadOrders(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Status
            </button>
          </div>

          {/* Summary — click a card to filter the list */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
            {([
              {
                label: 'Orders',
                value: summary.total,
                amount: summary.values.total,
                tone: 'purple',
                key: 'all',
              },
              {
                label: 'Not Shipped',
                value: summary.notShipped,
                amount: summary.values.notShipped,
                tone: 'slate',
                key: 'not_shipped',
              },
              {
                label: 'Delayed First',
                value: summary.delayed,
                amount: summary.values.delayed,
                tone: 'red',
                key: 'delayed',
              },
              {
                label: 'Delivered',
                value: summary.delivered,
                amount: summary.values.delivered,
                tone: 'emerald',
                key: 'delivered',
              },
              {
                label: 'In Transit',
                value: summary.inTransit,
                amount: summary.values.inTransit,
                tone: 'blue',
                key: 'in_transit',
              },
              {
                label: 'RTO Initiated',
                value: summary.rto,
                amount: summary.values.rto,
                tone: 'purple',
                key: 'rto',
              },
              {
                label: 'Cancelled',
                value: summary.cancelled,
                amount: summary.values.cancelled,
                tone: 'amber',
                key: 'cancelled',
              },
            ] as const).map((card) => (
              <button
                key={card.label}
                type="button"
                onClick={() => toggleQuickFilter(card.key)}
                className={`crm-card p-4 text-left transition-all cursor-pointer ${ringFor(card.key, card.tone)}`}
                title={`₹${card.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>
                  {card.label}
                </p>
                <p
                  className={`text-2xl font-extrabold mt-1 ${
                    card.tone === 'emerald'
                      ? 'text-emerald-600'
                      : card.tone === 'blue'
                        ? 'text-blue-600'
                        : card.tone === 'red'
                          ? 'text-red-600'
                          : card.tone === 'amber'
                            ? 'text-amber-600'
                            : card.tone === 'slate'
                              ? 'text-slate-700 dark:text-slate-300'
                              : 'text-purple-600'
                  }`}
                >
                  {card.value}
                </p>
                <p
                  className={`text-[11px] mt-1 font-semibold tabular-nums ${
                    card.tone === 'emerald'
                      ? 'text-emerald-600'
                      : card.tone === 'blue'
                        ? 'text-blue-600'
                        : card.tone === 'red'
                          ? 'text-red-600'
                          : card.tone === 'amber'
                            ? 'text-amber-600'
                            : card.tone === 'slate'
                              ? 'text-slate-600 dark:text-slate-400'
                              : 'text-purple-600'
                  }`}
                >
                  {fmtInrCompact(card.amount)}
                </p>
              </button>
            ))}
          </div>
          {(summary.total > 0 || total > 0) && (
            <p className="text-xs mb-3" style={{ color: 'var(--foreground-muted)' }}>
              {summary.total.toLocaleString('en-IN')} in range
              {' '}({channelBreakdown.shopify.toLocaleString('en-IN')} Shopify · {channelBreakdown.shiprocket.toLocaleString('en-IN')} Shiprocket-only)
              {` · ${total.toLocaleString('en-IN')} matching filters`}
            </p>
          )}

          {/* Filters */}
          <div className="crm-card p-4 mb-5 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--foreground-muted)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order name or order ID…"
                autoComplete="off"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-purple-500/50"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'shopify' | 'shiprocket' | 'all')}
                className="px-2.5 py-2 rounded-lg border text-xs"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                <option value="all">All channels</option>
                <option value="shopify">Shopify only</option>
                <option value="shiprocket">Shiprocket only</option>
              </select>
              <select value={courier} onChange={(e) => setCourier(e.target.value)} className="px-2.5 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="all">All Couriers</option>
                {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="all">All Payment Status</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
              <select value={fulfillmentStatus} onChange={(e) => setFulfillmentStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="all">All Fulfillment</option>
                <option value="unfulfilled">Order Created</option>
                <option value="processing">Processing</option>
                <option value="pickup_scheduled">Ready for Pickup</option>
                <option value="in_transit">In Transit</option>
                <option value="out_for_delivery">Out for Delivery</option>
                <option value="attempted_delivery">Undelivered / Attempted</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
                <option value="rto">RTO Initiated</option>
                <option value="rto_delivered">RTO Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select value={deliveryStatus} onChange={(e) => setDeliveryStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="all">All Delivery Status</option>
                <option value="not_shipped">Not Shipped</option>
                <option value="delayed">Delayed Only</option>
                <option value="delivered">Delivered</option>
                <option value="not_delivered">Not Delivered</option>
                <option value="in_transit">In Transit (Shiprocket)</option>
                <option value="out_for_delivery">Out for Delivery</option>
                <option value="rto">RTO Initiated</option>
                <option value="rto_delivered">RTO Delivered</option>
                <option value="cancelled">Cancelled</option>
                <option value="rto_alerts">RTO Initiated + Alerts</option>
              </select>
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider px-0.5" style={{ color: 'var(--foreground-muted)' }}>From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  autoComplete="off"
                  title="Optional — leave blank for all dates"
                  className="px-2.5 py-2 rounded-lg border text-xs"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider px-0.5" style={{ color: 'var(--foreground-muted)' }}>To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  autoComplete="off"
                  title="Optional — leave blank for all dates"
                  className="px-2.5 py-2 rounded-lg border text-xs"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const defaults = getDefaultDateRange()
                  setStartDate(defaults.start)
                  setEndDate(defaults.end)
                  setPage(1)
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                  isLast30Days
                    ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                    : 'hover:bg-blue-500/10 hover:text-blue-600 hover:border-blue-500/30'
                }`}
                style={isLast30Days ? undefined : { backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                title="Show orders from the last 30 days"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                {isLast30Days ? 'Last 30 days' : 'Set last 30 days'}
              </button>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-semibold text-purple-600 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/8 text-red-600 text-sm flex items-center gap-2">
              <XCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {loading && orders.length === 0 && total === 0 ? (
            <div className="crm-card p-12 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading order journeys…</p>
              <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>First sync can take up to a minute.</p>
            </div>
          ) : total === 0 && !filtersActive && summary.total === 0 ? (
            <div className="crm-card p-12 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>No orders loaded yet</p>
              <p className="text-sm mt-1 mb-4" style={{ color: 'var(--foreground-muted)' }}>
                Hit Refresh Status to pull the latest Shopify / Shiprocket data.
              </p>
              <button
                onClick={() => loadOrders(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-purple-600"
              >
                <RefreshCw className="w-4 h-4" /> Refresh Status
              </button>
            </div>
          ) : total === 0 ? (
            <div className="crm-card p-12 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>No orders match these filters</p>
              <p className="text-sm mt-1 mb-4" style={{ color: 'var(--foreground-muted)' }}>
                Clear the date range or other filters to see more orders.
              </p>
              <button type="button" onClick={clearFilters} className="text-sm font-semibold text-purple-600 hover:underline">
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                <p>
                  Showing{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {pageStart + 1}–{Math.min(pageStart + pageOrders.length, total)}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {total.toLocaleString('en-IN')}
                  </span>
                </p>
                <label className="inline-flex items-center gap-2">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                    className="px-2 py-1.5 rounded-lg border text-xs"
                    style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm" style={{ color: 'var(--foreground-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  Loading page {safePage}…
                </div>
              )}

              {pageOrders.map((order) => {
                const relatedClones = getRelatedClones(order)
                const parentOrder = order._parent || null
                return (
                  <div key={order.id} id={`order-card-${order.id}`}>
                    <OrderStatusCard
                      order={order}
                      expanded={expandedId === order.id}
                      onToggle={() => setExpandedId((id) => (id === order.id ? null : order.id))}
                      relatedClones={relatedClones}
                      parentOrder={parentOrder}
                      onOpenRelated={openRelatedOrder}
                      onNoteSaved={(orderId, note) => {
                        setOrders((prev) =>
                          prev.map((o) => (o.id === orderId ? { ...o, note: note || null } : o)),
                        )
                      }}
                    />
                  </div>
                )
              })}

              <div className="crm-card p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Page <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{safePage}</span> of{' '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{totalPages}</span>
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    <span>Per page</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                      className="px-2 py-1.5 rounded-lg border text-xs"
                      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => goToPage(1)}
                      disabled={safePage <= 1}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      First
                    </button>
                    <button
                      type="button"
                      onClick={() => goToPage(safePage - 1)}
                      disabled={safePage <= 1}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                      .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                        acc.push(p)
                        return acc
                      }, [])
                      .map((item, idx) =>
                        item === 'ellipsis' ? (
                          <span key={`e-${idx}`} className="px-1 text-xs" style={{ color: 'var(--foreground-muted)' }}>…</span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            onClick={() => goToPage(item)}
                            className={`min-w-[32px] px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                              item === safePage
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'hover:bg-purple-500/10'
                            }`}
                            style={item === safePage ? undefined : { borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          >
                            {item}
                          </button>
                        ),
                      )}

                    <button
                      type="button"
                      onClick={() => goToPage(safePage + 1)}
                      disabled={safePage >= totalPages}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => goToPage(totalPages)}
                      disabled={safePage >= totalPages}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 hover:bg-purple-500/10"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      Last
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
