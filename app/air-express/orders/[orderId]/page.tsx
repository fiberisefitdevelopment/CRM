'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressBackLink,
  AirExpressErrorBanner,
  AirExpressLoading,
  AirExpressPrimaryButton,
  AirExpressSection,
  AirExpressStatusBadge,
  airExpressInputClass,
} from '@/components/air-express/ui'
import {
  cancelAirExpressOrders,
  fetchAirExpressOrder,
  updateAirExpressDelivery,
  updateAirExpressPickup,
} from '@/lib/airExpressApi'

export default function AirExpressOrderDetailPage() {
  const params = useParams()
  const orderId = decodeURIComponent(String(params.orderId || ''))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<any>(null)
  const [pickupLocation, setPickupLocation] = useState('')
  const [deliveryForm, setDeliveryForm] = useState({
    shipping_customer_name: '',
    shipping_phone: '',
    shipping_address: '',
    shipping_address_2: '',
    shipping_city: '',
    shipping_state: '',
    shipping_country: 'India',
    shipping_pincode: '',
    shipping_email: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAirExpressOrder(orderId)
      const resolved = (data as any)?.data || data
      setOrder(resolved)
      setPickupLocation(resolved?.pickup_location || '')
      setDeliveryForm({
        shipping_customer_name: resolved?.billing_customer_name || '',
        shipping_phone: String(resolved?.billing_phone || ''),
        shipping_address: resolved?.billing_address || '',
        shipping_address_2: resolved?.billing_address_2 || '',
        shipping_city: resolved?.billing_city || '',
        shipping_state: resolved?.billing_state || '',
        shipping_country: resolved?.billing_country || 'India',
        shipping_pincode: String(resolved?.billing_pincode || ''),
        shipping_email: resolved?.billing_email || '',
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load order')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    load()
  }, [load])

  const handleCancel = async () => {
    if (!confirm(`Cancel order ${orderId}?`)) return
    try {
      await cancelAirExpressOrders([orderId])
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  const handlePickupUpdate = async () => {
    try {
      await updateAirExpressPickup({ order_id: [orderId], pickup_location: pickupLocation })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const handleDeliveryUpdate = async () => {
    try {
      await updateAirExpressDelivery({ order_id: orderId, ...deliveryForm })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const shipment = order?.shipment || order?.shipments?.[0]

  return (
    <AirExpressShell title="Order Details" subtitle={orderId}>
      <AirExpressBackLink href="/air-express/orders" label="Back to orders" />

      {loading ? (
        <AirExpressLoading label="Loading order…" />
      ) : error ? (
        <AirExpressErrorBanner message={error} />
      ) : (
        <div className="space-y-5">
          <AirExpressSection
            title={orderId}
            action={
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/8 font-semibold"
              >
                Cancel order
              </button>
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <AirExpressStatusBadge status={shipment?.status || order?.status} />
              <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                Payment: {order?.payment_method || '—'}
              </span>
              <span className="text-sm font-mono" style={{ color: 'var(--foreground-muted)' }}>
                Shipment: {shipment?.shipment_id || shipment?.id || '—'}
              </span>
              <span className="text-sm font-mono" style={{ color: 'var(--foreground-muted)' }}>
                AWB: {shipment?.awb || order?.awb_code || '—'}
              </span>
            </div>
          </AirExpressSection>

          <AirExpressSection title="Customer">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                ['Name', order?.billing_customer_name],
                ['Phone', order?.billing_phone],
                ['Email', order?.billing_email],
                ['Address', order?.billing_address],
                ['City', order?.billing_city],
                ['State', order?.billing_state],
                ['Pincode', order?.billing_pincode],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
                    {label}
                  </dt>
                  <dd style={{ color: 'var(--foreground)' }}>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </AirExpressSection>

          {Array.isArray(order?.order_items) && order.order_items.length > 0 && (
            <AirExpressSection title="Items">
              <div className="space-y-2">
                {order.order_items.map((item: any, i: number) => (
                  <div key={i} className="crm-card p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                    {item.name} · SKU {item.sku} · {item.units} × ₹{item.selling_price}
                  </div>
                ))}
              </div>
            </AirExpressSection>
          )}

          <AirExpressSection title="Update pickup location">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className={airExpressInputClass}
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                placeholder="Pickup location"
              />
              <AirExpressPrimaryButton onClick={handlePickupUpdate} className="shrink-0">
                Save pickup
              </AirExpressPrimaryButton>
            </div>
          </AirExpressSection>

          <AirExpressSection title="Update delivery address">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(deliveryForm).map(([key, value]) => (
                <input
                  key={key}
                  className={airExpressInputClass}
                  placeholder={key.replace(/_/g, ' ')}
                  value={value}
                  onChange={(e) =>
                    setDeliveryForm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              ))}
            </div>
            <AirExpressPrimaryButton onClick={handleDeliveryUpdate} className="mt-3">
              Update delivery
            </AirExpressPrimaryButton>
          </AirExpressSection>
        </div>
      )}
    </AirExpressShell>
  )
}
