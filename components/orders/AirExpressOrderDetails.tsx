'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ExternalLink, Loader2, Plane } from 'lucide-react'
import { fetchAirExpressOrder, trackAirExpressByOrder } from '@/lib/airExpressApi'
import {
  orderTrailUsesAirExpress,
  resolveAirExpressOrderIdForCrmOrder,
} from '@/src/utils/airExpressOrder'
import { parseFlexibleDate } from '@/src/utils/orderTimeline'

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

function unwrapAePayload(data: unknown): any {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.data && typeof obj.data === 'object') return obj.data
  return obj
}

function unwrapAeTracking(data: unknown): any {
  const root = unwrapAePayload(data)
  if (!root) return null
  return root.tracking_data || root
}

/** Air Express (Aaysh) shipment block on Order Status expanded view. */
export function AirExpressOrderDetails({
  order,
  live,
  relatedClones,
  active,
}: {
  order?: any
  live?: any
  relatedClones?: any[]
  /** Fetch when the order card is expanded. */
  active: boolean
}) {
  const aeOrderId = resolveAirExpressOrderIdForCrmOrder(order, live, relatedClones)
  const isAe = orderTrailUsesAirExpress(order, live, relatedClones)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aeOrder, setAeOrder] = useState<any>(null)
  const [tracking, setTracking] = useState<any>(null)

  useEffect(() => {
    if (!active || !isAe || !aeOrderId) {
      setAeOrder(null)
      setTracking(null)
      setError(null)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [orderRes, trackRes] = await Promise.all([
          fetchAirExpressOrder(aeOrderId),
          trackAirExpressByOrder(aeOrderId).catch(() => null),
        ])
        if (cancelled) return
        setAeOrder(unwrapAePayload(orderRes))
        setTracking(unwrapAeTracking(trackRes))
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Air Express details')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, isAe, aeOrderId])

  if (!isAe) return null

  const shipment = aeOrder?.shipment || aeOrder?.shipments?.[0] || {}
  const trackShipment = tracking?.shipment_track || {}
  const trackActs: any[] = tracking?.shipment_track_activities || []

  const awb = shipment?.awb || trackShipment?.awb || aeOrder?.awb_code
  const courier = shipment?.courier || trackShipment?.courier
  const status = shipment?.status || trackShipment?.current_status || aeOrder?.status
  const shipmentId = shipment?.shipment_id || shipment?.id || trackShipment?.shipment_id
  const pickupLocation = shipment?.pickup_location || trackShipment?.pickup_location || aeOrder?.pickup_location
  const customer = aeOrder?.customer || {}
  const shipAddr = aeOrder?.shipping_address || {}
  const recipientName =
    trackShipment?.customer_name ||
    customer?.name ||
    aeOrder?.billing_customer_name ||
    '—'
  const recipientPhone = trackShipment?.customer_phone || customer?.phone || aeOrder?.billing_phone
  const destination =
    trackShipment?.destination ||
    [shipAddr?.city, shipAddr?.state].filter(Boolean).join(', ') ||
    '—'
  const deliveryAddress = [
    shipAddr?.address,
    shipAddr?.address2,
    shipAddr?.city,
    shipAddr?.state,
    shipAddr?.pincode,
    shipAddr?.country,
  ]
    .filter((p) => p != null && String(p).trim() !== '')
    .join(', ')

  return (
    <div
      className="rounded-xl border p-4 bg-sky-500/[0.04] border-sky-500/25"
      style={{ background: 'var(--card)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <h3
          className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 text-sky-700 dark:text-sky-300"
        >
          <Plane className="w-3.5 h-3.5" /> Air Express (Aaysh)
        </h3>
        {aeOrderId && (
          <Link
            href={`/air-express/orders/${encodeURIComponent(aeOrderId)}`}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:underline"
          >
            Open in Air Express <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      {loading && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--foreground-muted)' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Air Express details…
        </p>
      )}

      {error && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      {!loading && !error && aeOrder && (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              ['AE Order', aeOrder.order_id || aeOrderId],
              ['Shipment ID', shipmentId],
              ['AWB', awb],
              ['Courier', courier],
              ['Status', status],
              ['Payment', aeOrder.payment_method],
              ['Pickup Date', aeOrder.pickup_date],
              ['Created', fmtWhen(aeOrder.created_at)],
              ['Delivery Attempts', shipment?.delivery_attempts ?? trackShipment?.delivery_attempts ?? '—'],
              ['Pickup Location', pickupLocation],
            ].map(([k, v]) => (
              <div key={k as string} className={k === 'Pickup Location' ? 'sm:col-span-2' : undefined}>
                <dt className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>
                  {k}
                </dt>
                <dd className="font-semibold break-words whitespace-pre-line" style={{ color: 'var(--foreground)' }}>
                  {v != null && String(v).trim() !== '' ? String(v) : '—'}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 pt-3 border-t border-sky-500/20">
            <p className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--foreground-muted)' }}>
              Delivery
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                ['Recipient', recipientName],
                ['Phone', recipientPhone],
                ['Destination', destination],
                ['Delivered', String(status || '').toLowerCase().includes('deliver') ? 'Yes' : 'No'],
                ['Address', deliveryAddress || '—'],
              ].map(([k, v]) => (
                <div key={k as string} className={k === 'Address' ? 'sm:col-span-2' : undefined}>
                  <dt className="text-[10px] font-bold uppercase" style={{ color: 'var(--foreground-muted)' }}>
                    {k}
                  </dt>
                  <dd className="font-semibold break-words" style={{ color: 'var(--foreground)' }}>
                    {v != null && String(v).trim() !== '' && String(v).trim() !== '-' ? String(v) : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {trackActs.length > 0 ? (
            <div className="mt-4 pt-3 border-t border-sky-500/20">
              <p className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Live Courier Trail
              </p>
              <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {trackActs.slice(0, 12).map((a, i) => (
                  <li key={i} className="text-xs border-l-2 pl-2 border-sky-500/30">
                    <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {a.activity || a.status || a.current_status || 'Update'}
                    </p>
                    <p style={{ color: 'var(--foreground-muted)' }}>
                      {fmtWhen(a.date || a.timestamp)} · {a.location || a.city || '—'}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            !loading &&
            aeOrder &&
            awb && (
              <p className="mt-4 pt-3 border-t border-sky-500/20 text-xs" style={{ color: 'var(--foreground-muted)' }}>
                No scan events yet for AWB {awb}.
              </p>
            )
          )}
        </>
      )}

      {!loading && !error && !aeOrder && aeOrderId && (
        <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
          No Air Express record found for order {aeOrderId}.
        </p>
      )}
    </div>
  )
}
