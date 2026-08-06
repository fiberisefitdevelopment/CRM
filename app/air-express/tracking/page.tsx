'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressCodeBlock,
  AirExpressErrorBanner,
  AirExpressPrimaryButton,
  AirExpressSection,
  airExpressInputClass,
} from '@/components/air-express/ui'
import {
  trackAirExpressByAwb,
  trackAirExpressByOrder,
  trackAirExpressByShipment,
  trackAirExpressMultiple,
} from '@/lib/airExpressApi'
import { cn } from '@/lib/utils'

type TrackMode = 'awb' | 'shipment' | 'order' | 'multiple'

export default function AirExpressTrackingPage() {
  const [mode, setMode] = useState<TrackMode>('awb')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)

  const handleTrack = async () => {
    if (!query.trim()) {
      setError('Enter a value to track')
      return
    }
    try {
      setLoading(true)
      setError(null)
      setResult(null)
      let data: unknown
      if (mode === 'awb') data = await trackAirExpressByAwb(query.trim())
      else if (mode === 'shipment') data = await trackAirExpressByShipment(query.trim())
      else if (mode === 'order') data = await trackAirExpressByOrder(query.trim())
      else {
        const awbs = query.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        data = await trackAirExpressMultiple(awbs)
      }
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Tracking failed')
    } finally {
      setLoading(false)
    }
  }

  const history =
    (result as any)?.tracking_history ||
    (result as any)?.history ||
    (result as any)?.data?.tracking_history ||
    []

  return (
    <AirExpressShell title="Tracking" subtitle="Track shipments by AWB, shipment ID, or order ID.">
      <AirExpressSection title="Track shipment">
        <div className="flex flex-wrap gap-2 mb-4">
          {([
            ['awb', 'By AWB'],
            ['shipment', 'By Shipment ID'],
            ['order', 'By Order ID'],
            ['multiple', 'Multiple AWBs'],
          ] as [TrackMode, string][]).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                mode === m
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'border-theme text-muted hover:text-theme',
              )}
              style={mode !== m ? { borderColor: 'var(--border)', color: 'var(--foreground-muted)' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className={airExpressInputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'multiple'
                ? 'AWB numbers (comma-separated)'
                : mode === 'awb'
                  ? 'AWB number'
                  : mode === 'shipment'
                    ? 'Shipment ID'
                    : 'Order ID'
            }
            onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
          />
          <AirExpressPrimaryButton onClick={handleTrack} loading={loading} className="shrink-0">
            <Search className="w-4 h-4" />
            Track
          </AirExpressPrimaryButton>
        </div>

        {error && <div className="mt-3"><AirExpressErrorBanner message={error} /></div>}

        {result != null && (
          <div className="mt-5 space-y-4">
            {Array.isArray(history) && history.length > 0 && (
              <div>
                <p className="text-sm font-bold mb-2" style={{ color: 'var(--foreground)' }}>
                  Tracking history
                </p>
                <div className="space-y-2">
                  {history.map((h: any, i: number) => (
                    <div
                      key={i}
                      className="crm-card p-3 text-sm"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {h.status || h.activity || h.label}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--foreground-muted)' }}>
                        {h.date || h.timestamp || h.created_at}
                      </p>
                      {h.location && (
                        <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                          {h.location}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <AirExpressCodeBlock data={result} />
          </div>
        )}
      </AirExpressSection>
    </AirExpressShell>
  )
}
