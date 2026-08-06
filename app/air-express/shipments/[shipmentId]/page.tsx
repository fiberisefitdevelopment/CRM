'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressBackLink,
  AirExpressCodeBlock,
  AirExpressErrorBanner,
  AirExpressLoading,
  AirExpressSection,
  AirExpressStatusBadge,
} from '@/components/air-express/ui'
import { cancelAirExpressShipments, fetchAirExpressShipment } from '@/lib/airExpressApi'

export default function AirExpressShipmentDetailPage() {
  const params = useParams()
  const shipmentId = decodeURIComponent(String(params.shipmentId || ''))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shipment, setShipment] = useState<any>(null)

  const load = useCallback(async () => {
    if (!shipmentId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAirExpressShipment(shipmentId)
      setShipment((data as any)?.data || data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shipment')
    } finally {
      setLoading(false)
    }
  }, [shipmentId])

  useEffect(() => {
    load()
  }, [load])

  const handleCancel = async () => {
    const awb = shipment?.awb || shipment?.awb_code
    if (!awb || !confirm(`Cancel shipment AWB ${awb}?`)) return
    try {
      await cancelAirExpressShipments([String(awb)])
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  return (
    <AirExpressShell title="Shipment Details" subtitle={shipmentId}>
      <AirExpressBackLink href="/air-express/shipments" label="Back to shipments" />

      {loading ? (
        <AirExpressLoading label="Loading shipment…" />
      ) : error ? (
        <AirExpressErrorBanner message={error} />
      ) : (
        <AirExpressSection
          title={`Shipment ${shipmentId}`}
          action={
            shipment?.awb ? (
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/8 font-semibold"
              >
                Cancel shipment
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <AirExpressStatusBadge status={shipment?.status} />
            <span className="text-sm font-mono" style={{ color: 'var(--foreground-muted)' }}>
              AWB: {shipment?.awb || '—'}
            </span>
            <span className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
              Courier: {shipment?.courier_name || '—'}
            </span>
          </div>
          <AirExpressCodeBlock data={shipment} />
        </AirExpressSection>
      )}
    </AirExpressShell>
  )
}
