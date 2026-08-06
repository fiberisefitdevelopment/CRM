'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressCodeBlock,
  AirExpressErrorBanner,
  AirExpressPrimaryButton,
  AirExpressSection,
  airExpressInputClass,
} from '@/components/air-express/ui'
import {
  assignAirExpressAwb,
  extractList,
  fetchAirExpressCouriers,
} from '@/lib/airExpressApi'

export default function AirExpressCouriersPage() {
  const [couriers, setCouriers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)
  const [form, setForm] = useState({
    serviceType: 'surface',
    shipments: '',
    pickupDate: new Date().toISOString().slice(0, 10),
    pickupTime: '11:00 AM',
    pickupLocation: '',
    notes: '',
  })

  const loadCouriers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAirExpressCouriers()
      setCouriers(extractList(data, ['data', 'couriers', 'courierList', 'results']))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load couriers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCouriers()
  }, [loadCouriers])

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    const shipmentIds = form.shipments
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!shipmentIds.length) {
      setError('Enter at least one shipment ID')
      return
    }
    try {
      setSubmitting(true)
      setError(null)
      setResult(null)
      const data = await assignAirExpressAwb({
        serviceType: form.serviceType,
        shipments: shipmentIds,
        pickupDate: new Date(form.pickupDate).toISOString(),
        pickupTime: form.pickupTime,
        pickupLocation: form.pickupLocation,
        notes: form.notes || undefined,
      })
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'AWB assignment failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AirExpressShell title="Couriers & AWB" subtitle="View available couriers and assign AWB with pickup.">
      <AirExpressSection title="Available couriers">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
            <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading couriers…</span>
          </div>
        ) : couriers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No couriers returned from Aaysh Express.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {couriers.map((c, i) => (
              <span key={i} className="badge-info px-3 py-1 rounded-lg text-xs font-semibold">
                {c.name || c.courier_name || c.id || JSON.stringify(c)}
              </span>
            ))}
          </div>
        )}
      </AirExpressSection>

      <form onSubmit={handleAssign} className="mt-5">
        <AirExpressSection title="Assign AWB & schedule pickup">
          {error && <div className="mb-3"><AirExpressErrorBanner message={error} /></div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className={airExpressInputClass} value={form.serviceType} onChange={(e) => setForm((p) => ({ ...p, serviceType: e.target.value }))}>
              <option value="surface">Surface</option>
              <option value="air">Air</option>
              <option value="prime">Prime</option>
            </select>
            <input className={airExpressInputClass} value={form.shipments} onChange={(e) => setForm((p) => ({ ...p, shipments: e.target.value }))} placeholder="Shipment IDs (comma-separated) *" required />
            <input className={airExpressInputClass} type="date" value={form.pickupDate} onChange={(e) => setForm((p) => ({ ...p, pickupDate: e.target.value }))} required />
            <input className={airExpressInputClass} value={form.pickupTime} onChange={(e) => setForm((p) => ({ ...p, pickupTime: e.target.value }))} placeholder="Pickup time (11:00 AM – 5:00 PM) *" required />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.pickupLocation} onChange={(e) => setForm((p) => ({ ...p, pickupLocation: e.target.value }))} placeholder="Pickup location *" required />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" />
          </div>
          <AirExpressPrimaryButton type="submit" loading={submitting} className="mt-4">
            Assign AWB
          </AirExpressPrimaryButton>
          {result != null && (
            <div className="mt-4">
              <AirExpressCodeBlock data={result} />
            </div>
          )}
        </AirExpressSection>
      </form>
    </AirExpressShell>
  )
}
