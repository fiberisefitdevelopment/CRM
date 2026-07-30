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
} from 'lucide-react'
import { getPaymentLabel, isCodOrder } from '@/src/utils/orderPayment'
import {
  buildAlerts,
  buildTimeline,
  fulfillmentStageLabel,
  getDelayDays,
  getShipmentDate,
  isOrderDelayed,
  normalizeShipmentStatus,
  paymentLabel,
  type TimelineStep,
} from '@/src/utils/orderTimeline'

interface OrderRow {
  id: number
  name: string
  created_at: string
  financial_status: string
  payment_method?: string | null
  fulfillment_status: string | null
  total_price: string
  cancelled_at?: string | null
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
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
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
  const d = new Date(value)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  // Fallback for DD-MM-YYYY…
  const m = String(value).match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m) {
    const parsed = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    }
  }
  return String(value)
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
  if (status === 'rto' || status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'out_for_delivery' || status === 'ready_pickup' || status === 'pickup_scheduled') return 'amber'
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
}: {
  order: OrderRow
  expanded: boolean
  onToggle: () => void
  onNoteSaved: (orderId: number, note: string) => void
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
  const timeline = useMemo(() => buildTimeline(order, tracking), [order, tracking])
  const meta = order.shiprocket_meta || {}
  const shipmentDate = getShipmentDate(order)
  const delayDays = getDelayDays(order)

  useEffect(() => {
    setNoteDraft(order.note || '')
  }, [order.note])

  useEffect(() => {
    if (!expanded || !awb || tracking) return
    let cancelled = false
    ;(async () => {
      try {
        setTrackLoading(true)
        setTrackError(null)
        const res = await fetch(`/api/order-status/track?awb=${encodeURIComponent(awb)}`)
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
  }, [expanded, awb, tracking])

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
      className={`crm-card overflow-hidden border ${delayed ? 'ring-1 ring-red-500/40' : ''}`}
      style={{ borderColor: delayed ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)' }}
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
              <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--foreground-muted)' }}>
                Order
                {delayed && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('red')}`}>
                    Delayed
                  </span>
                )}
                {order.source === 'shiprocket' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('purple')}`}>
                    Shiprocket
                  </span>
                )}
              </p>
              <p className="text-sm font-extrabold" style={{ color: 'var(--foreground)' }}>
                {order.name}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                ID {order.id} · {fmtWhen(order.created_at)}
              </p>
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
                Fulfillment
              </p>
              <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded border mt-0.5 ${badgeTone(statusTone(status))}`}>
                {fulfillmentStageLabel(status)}
              </span>
              <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--foreground-muted)' }}>
                {fulfillment?.tracking_company || 'No courier yet'}
                {awb ? ` · ${awb}` : ''}
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
            {fmtDay(shipmentDate)}
          </span>
          {meta.etd_date && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 opacity-70" />
              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>ETD</span>
              {fmtDay(meta.etd_date)}
            </span>
          )}
          {delayed && (
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded border ${badgeTone('red')}`}>
              <AlertCircle className="w-3 h-3" />
              {delayDays > 0
                ? `Delayed by ${delayDays} day${delayDays === 1 ? '' : 's'}`
                : 'Delayed (ETD today / flagged)'}
            </span>
          )}
        </div>

        {alerts.length > 0 && (
          <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
            {alerts
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
                    ['Courier Partner', fulfillment?.tracking_company || '—'],
                    ['Tracking Number', awb || '—'],
                    ['Warehouse', meta.pickup_location || '—'],
                    ['Shipping Method', meta.shipping_method || '—'],
                    ['Estimated Delivery', fmtWhen(meta.etd_date || tracking?.tracking_data?.etd)],
                    ['Actual Delivery', fmtWhen(meta.delivered_date || fulfillment?.delivery_date)],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <dt className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>{k}</dt>
                      <dd className="font-semibold break-all" style={{ color: 'var(--foreground)' }}>{v as string}</dd>
                    </div>
                  ))}
                </dl>
                {(fulfillment?.tracking_url || tracking?.tracking_data?.track_url) && (
                  <a
                    href={fulfillment?.tracking_url || tracking?.tracking_data?.track_url}
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
                    ['Current Status', fulfillmentStageLabel(status)],
                    ['Delivered', status === 'delivered' ? 'Yes' : 'No'],
                    ['Dispatched', fulfillment?.tracking_number || meta.picked_up_date ? 'Yes' : 'No'],
                    ['Recipient', trackInfo?.consignee_name || customerName(order)],
                    ['Delivery Proof', trackInfo?.pod || trackInfo?.pod_status || '—'],
                    ['Delivery Notes', fulfillment?.shipment_status_reason || meta.delay_reason || '—'],
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
                  <p className="font-extrabold text-emerald-600">{status === 'delivered' ? 1 : 0}</p>
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
              {meta.has_calls ? (
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
              {!awb && <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>No AWB assigned yet.</p>}
              {awb && !trackLoading && trackActs.length === 0 && !trackError && (
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

export default function OrderStatusPage() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20)

  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState<'shopify' | 'shiprocket' | 'all'>('shopify')
  const [courier, setCourier] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all')
  const [deliveryStatus, setDeliveryStatus] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const loadOrders = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true)
      else setLoading(true)
      setError(null)

      const url = force ? '/api/shopify/orders?all=true&refresh=true' : '/api/shopify/orders?all=true'
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load orders')

      // Cold start: keep polling until cache is seeded (Shopify usually lands in a few seconds)
      if (data.syncing && (!data.orders || data.orders.length === 0)) {
        setLoading(true)
        setTimeout(() => loadOrders(false), 1500)
        return
      }

      setOrders(Array.isArray(data.orders) ? data.orders : [])
      setLastSynced(new Date())
      setLoading(false)
      setRefreshing(false)
    } catch (err: any) {
      setError(err.message || 'Failed to load order status')
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadOrders(false)
  }, [loadOrders])

  const clearFilters = () => {
    setSearch('')
    setChannel('shopify')
    setCourier('all')
    setPaymentStatus('all')
    setFulfillmentStatus('all')
    setDeliveryStatus('all')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  const couriers = useMemo(() => {
    const set = new Set<string>()
    orders.forEach((o) => {
      const c = o.fulfillments?.[0]?.tracking_company
      if (c) set.add(c)
    })
    return Array.from(set).sort()
  }, [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const hasStart = Boolean(startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate))
    const hasEnd = Boolean(endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate))

    const list = orders.filter((o) => {
      // Default Shopify channel matches Shopify Admin order count
      const isSrOnly = o.source === 'shiprocket'
      if (channel === 'shopify' && isSrOnly) return false
      if (channel === 'shiprocket' && !isSrOnly) return false

      if (q) {
        const hay = [
          o.name,
          String(o.id),
          customerName(o),
          customerPhone(o),
          o.fulfillments?.[0]?.tracking_number || '',
          o.customer?.email || '',
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }

      const status = normalizeShipmentStatus(o)
      const pay = paymentLabel(o)
      const company = o.fulfillments?.[0]?.tracking_company || ''

      if (courier !== 'all' && company !== courier) return false
      if (paymentStatus !== 'all' && pay.toLowerCase() !== paymentStatus) return false
      if (fulfillmentStatus !== 'all' && status !== fulfillmentStatus) return false
      if (deliveryStatus === 'delivered' && status !== 'delivered') return false
      if (deliveryStatus === 'not_delivered' && status === 'delivered') return false
      if (deliveryStatus === 'in_transit' && !['in_transit', 'out_for_delivery'].includes(status)) return false
      if (deliveryStatus === 'rto' && status !== 'rto') return false
      if (deliveryStatus === 'delayed' && !isOrderDelayed(o)) return false
      if (deliveryStatus === 'rto_alerts' && status !== 'rto' && buildAlerts(o).length === 0) return false

      if (hasStart || hasEnd) {
        const parsed = new Date(o.created_at)
        let key = ''
        if (!isNaN(parsed.getTime())) {
          key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
        } else if (/^\d{4}-\d{2}-\d{2}/.test(o.created_at || '')) {
          key = o.created_at.slice(0, 10)
        } else {
          return true // don't drop orders with unparseable dates when filtering
        }
        if (hasStart && key < startDate) return false
        if (hasEnd && key > endDate) return false
      }

      return true
    })

    // Most-delayed days first, then other delayed, then newest created
    return list.sort((a, b) => {
      const aDays = getDelayDays(a)
      const bDays = getDelayDays(b)
      const aDelayed = isOrderDelayed(a) ? 1 : 0
      const bDelayed = isOrderDelayed(b) ? 1 : 0

      // Delayed ahead of non-delayed
      if (aDelayed !== bDelayed) return bDelayed - aDelayed
      // Among delayed: highest delay days first
      if (aDelayed && bDelayed && aDays !== bDays) return bDays - aDays
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    })
  }, [orders, search, channel, courier, paymentStatus, fulfillmentStatus, deliveryStatus, startDate, endDate])

  const filtersActive =
    search.trim() !== '' ||
    channel !== 'shopify' ||
    courier !== 'all' ||
    paymentStatus !== 'all' ||
    fulfillmentStatus !== 'all' ||
    deliveryStatus !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate)

  const channelBreakdown = useMemo(() => {
    const shopify = orders.filter((o) => o.source !== 'shiprocket').length
    const shiprocket = orders.filter((o) => o.source === 'shiprocket').length
    return { shopify, shiprocket }
  }, [orders])

  // Base list for summary cards (everything except the quick deliveryStatus card filter)
  const summaryBase = useMemo(() => {
    const q = search.trim().toLowerCase()
    const hasStart = Boolean(startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate))
    const hasEnd = Boolean(endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate))

    return orders.filter((o) => {
      const isSrOnly = o.source === 'shiprocket'
      if (channel === 'shopify' && isSrOnly) return false
      if (channel === 'shiprocket' && !isSrOnly) return false
      if (q) {
        const hay = [
          o.name,
          String(o.id),
          customerName(o),
          customerPhone(o),
          o.fulfillments?.[0]?.tracking_number || '',
          o.customer?.email || '',
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      const status = normalizeShipmentStatus(o)
      const pay = paymentLabel(o)
      const company = o.fulfillments?.[0]?.tracking_company || ''
      if (courier !== 'all' && company !== courier) return false
      if (paymentStatus !== 'all' && pay.toLowerCase() !== paymentStatus) return false
      if (fulfillmentStatus !== 'all' && status !== fulfillmentStatus) return false
      if (hasStart || hasEnd) {
        const parsed = new Date(o.created_at)
        let key = ''
        if (!isNaN(parsed.getTime())) {
          key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
        } else if (/^\d{4}-\d{2}-\d{2}/.test(o.created_at || '')) {
          key = o.created_at.slice(0, 10)
        } else {
          return true
        }
        if (hasStart && key < startDate) return false
        if (hasEnd && key > endDate) return false
      }
      return true
    })
  }, [orders, search, channel, courier, paymentStatus, fulfillmentStatus, startDate, endDate])

  const summary = useMemo(() => {
    const counts = { total: summaryBase.length, delivered: 0, inTransit: 0, delayed: 0, rto: 0, alerts: 0 }
    summaryBase.forEach((o) => {
      const s = normalizeShipmentStatus(o)
      if (s === 'delivered') counts.delivered++
      if (s === 'in_transit' || s === 'out_for_delivery') counts.inTransit++
      if (isOrderDelayed(o)) counts.delayed++
      if (s === 'rto') counts.rto++
      counts.alerts += buildAlerts(o).length
    })
    return counts
  }, [summaryBase])

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
    }
    return map[tone] || map.purple
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageOrders = filtered.slice(pageStart, pageStart + pageSize)

  // Reset to page 1 whenever filters / page size change
  useEffect(() => {
    setPage(1)
    setExpandedId(null)
  }, [search, channel, courier, paymentStatus, fulfillmentStatus, deliveryStatus, startDate, endDate, pageSize])

  // Clamp page if filtered results shrink
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {([
              {
                label: 'Matching Orders',
                value: summary.total,
                tone: 'purple',
                key: 'all',
                hint: deliveryStatus === 'all' ? 'All matching orders' : 'Click to show all',
              },
              {
                label: 'Delayed First',
                value: summary.delayed,
                tone: 'red',
                key: 'delayed',
                hint:
                  deliveryStatus === 'delayed'
                    ? 'Showing delayed only · click to clear'
                    : 'Past ETD / flagged · click to filter',
              },
              {
                label: 'Delivered',
                value: summary.delivered,
                tone: 'emerald',
                key: 'delivered',
                hint:
                  deliveryStatus === 'delivered'
                    ? 'Showing delivered · click to clear'
                    : 'Successfully delivered · click to view',
              },
              {
                label: 'In Transit / OFD',
                value: summary.inTransit,
                tone: 'blue',
                key: 'in_transit',
                hint:
                  deliveryStatus === 'in_transit'
                    ? 'Showing in transit & OFD · click to clear'
                    : 'In transit or out for delivery · click to view',
              },
              {
                label: 'RTO + Alerts',
                value: `${summary.rto} / ${summary.alerts}`,
                tone: 'purple',
                key: 'rto_alerts',
                hint:
                  deliveryStatus === 'rto_alerts'
                    ? 'Showing RTO & alert orders · click to clear'
                    : 'RTO returns + delay/failure alerts · click to view',
              },
            ] as const).map((card) => (
              <button
                key={card.label}
                type="button"
                onClick={() => toggleQuickFilter(card.key)}
                className={`crm-card p-4 text-left transition-all cursor-pointer ${ringFor(card.key, card.tone)}`}
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
                          : 'text-purple-600'
                  }`}
                >
                  {card.value}
                </p>
                <p
                  className={`text-[10px] mt-1 font-medium ${
                    card.tone === 'emerald'
                      ? 'text-emerald-600'
                      : card.tone === 'blue'
                        ? 'text-blue-600'
                        : card.tone === 'red'
                          ? 'text-red-600'
                          : 'text-purple-600'
                  }`}
                >
                  {card.hint}
                </p>
              </button>
            ))}
          </div>
          {orders.length > 0 && (
            <p className="text-xs mb-3" style={{ color: 'var(--foreground-muted)' }}>
              Loaded {orders.length.toLocaleString('en-IN')} from sync
              {' '}({channelBreakdown.shopify.toLocaleString('en-IN')} Shopify · {channelBreakdown.shiprocket.toLocaleString('en-IN')} Shiprocket-only)
              {` · ${filtered.length.toLocaleString('en-IN')} matching`}
            </p>
          )}

          {/* Filters */}
          <div className="crm-card p-4 mb-5 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--foreground-muted)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order ID, tracking #, customer name, phone…"
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
                <option value="shopify">Shopify only</option>
                <option value="all">All channels</option>
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
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
                <option value="rto">RTO</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select value={deliveryStatus} onChange={(e) => setDeliveryStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border text-xs" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="all">All Delivery Status</option>
                <option value="delayed">Delayed Only</option>
                <option value="delivered">Delivered</option>
                <option value="not_delivered">Not Delivered</option>
                <option value="in_transit">In Transit / OFD</option>
                <option value="rto">RTO</option>
                <option value="rto_alerts">RTO + Alerts</option>
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
            {(startDate || endDate) && (
              <p className="text-[11px]" style={{ color: 'var(--foreground-muted)' }}>
                Date filter active{startDate ? ` from ${startDate}` : ''}{endDate ? ` to ${endDate}` : ''} — clear dates to show all orders.
              </p>
            )}
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

          {error && (
            <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/8 text-red-600 text-sm flex items-center gap-2">
              <XCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {loading && orders.length === 0 ? (
            <div className="crm-card p-12 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading order journeys…</p>
              <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>First sync can take up to a minute.</p>
            </div>
          ) : orders.length === 0 ? (
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
          ) : filtered.length === 0 ? (
            <div className="crm-card p-12 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>No orders match these filters</p>
              <p className="text-sm mt-1 mb-4" style={{ color: 'var(--foreground-muted)' }}>
                {orders.length.toLocaleString('en-IN')} orders are loaded — clear the date range or other filters.
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
                    {filtered.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    {filtered.length.toLocaleString('en-IN')}
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

              {pageOrders.map((order) => (
                <OrderStatusCard
                  key={order.id}
                  order={order}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId((id) => (id === order.id ? null : order.id))}
                  onNoteSaved={(orderId, note) => {
                    setOrders((prev) =>
                      prev.map((o) => (o.id === orderId ? { ...o, note: note || null } : o)),
                    )
                  }}
                />
              ))}

              {totalPages > 1 && (
                <div className="crm-card p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    Page <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{safePage}</span> of{' '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{totalPages}</span>
                  </p>
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
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
