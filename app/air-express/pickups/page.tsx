'use client'

import { useCallback, useEffect, useState } from 'react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressEmptyState,
  AirExpressErrorBanner,
  AirExpressLoading,
  AirExpressPrimaryButton,
  AirExpressRefreshButton,
  AirExpressSection,
  airExpressInputClass,
} from '@/components/air-express/ui'
import {
  cancelAirExpressPickup,
  extractList,
  fetchAirExpressPickups,
  rescheduleAirExpressPickup,
} from '@/lib/airExpressApi'

export default function AirExpressPickupsPage() {
  const [pickups, setPickups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rescheduleForm, setRescheduleForm] = useState({
    shipmentId: '',
    pickupDate: new Date().toISOString().slice(0, 10),
    pickupTime: '14:00',
    pickupLocation: '',
    notes: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAirExpressPickups()
      setPickups(extractList(data, ['data', 'pickups', 'results']))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pickups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await rescheduleAirExpressPickup({
        ...rescheduleForm,
        pickupDate: new Date(rescheduleForm.pickupDate).toISOString(),
      })
      await load()
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reschedule failed')
    }
  }

  const handleCancel = async (shipmentId: string) => {
    if (!confirm(`Cancel pickup for shipment ${shipmentId}?`)) return
    try {
      await cancelAirExpressPickup(shipmentId)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  return (
    <AirExpressShell
      title="Pickups"
      subtitle="View, reschedule, and cancel scheduled pickups."
      actions={<AirExpressRefreshButton loading={loading} onClick={load} />}
    >
      {error && <AirExpressErrorBanner message={error} />}

      {loading ? (
        <AirExpressLoading label="Loading pickups…" />
      ) : pickups.length === 0 ? (
        <AirExpressEmptyState title="No pickups scheduled" description="Scheduled pickups will appear here after AWB assignment." />
      ) : (
        <AirExpressSection title="Scheduled pickups">
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Shipment ID</th>
                  <th>Pickup date</th>
                  <th>Time</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((p, i) => {
                  const shipmentId = p.shipmentId || p.shipment_id || p.id
                  return (
                    <tr key={i}>
                      <td className="font-mono text-xs">{shipmentId}</td>
                      <td>{p.pickupDate || p.pickup_date || '—'}</td>
                      <td>{p.pickupTime || p.pickup_time || '—'}</td>
                      <td>{p.pickupLocation || p.pickup_location || '—'}</td>
                      <td>{p.pickupStatus || p.status || '—'}</td>
                      <td className="text-right space-x-3">
                        <button
                          type="button"
                          onClick={() => setRescheduleForm((f) => ({ ...f, shipmentId: String(shipmentId) }))}
                          className="text-sky-600 hover:text-sky-500 text-xs font-semibold"
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(String(shipmentId))}
                          className="text-red-500 hover:text-red-400 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </AirExpressSection>
      )}

      <form onSubmit={handleReschedule} className="mt-5">
        <AirExpressSection title="Reschedule pickup">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className={airExpressInputClass} value={rescheduleForm.shipmentId} onChange={(e) => setRescheduleForm((p) => ({ ...p, shipmentId: e.target.value }))} placeholder="Shipment ID *" required />
            <input className={airExpressInputClass} type="date" value={rescheduleForm.pickupDate} onChange={(e) => setRescheduleForm((p) => ({ ...p, pickupDate: e.target.value }))} required />
            <input className={airExpressInputClass} value={rescheduleForm.pickupTime} onChange={(e) => setRescheduleForm((p) => ({ ...p, pickupTime: e.target.value }))} placeholder="Pickup time (24h, 11:00–17:00 IST) *" required />
            <input className={airExpressInputClass} value={rescheduleForm.pickupLocation} onChange={(e) => setRescheduleForm((p) => ({ ...p, pickupLocation: e.target.value }))} placeholder="Pickup location *" required />
            <input className={`${airExpressInputClass} md:col-span-2`} value={rescheduleForm.notes} onChange={(e) => setRescheduleForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes" />
          </div>
          <AirExpressPrimaryButton type="submit" className="mt-4">
            Reschedule
          </AirExpressPrimaryButton>
        </AirExpressSection>
      </form>
    </AirExpressShell>
  )
}
