'use client'

import { useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressCodeBlock,
  AirExpressErrorBanner,
  AirExpressPrimaryButton,
  AirExpressSection,
  airExpressInputClass,
} from '@/components/air-express/ui'
import { downloadAirExpressDocument } from '@/lib/airExpressApi'
import type { AayshPdfType } from '@/src/services/aayshExpressClient'

export default function AirExpressDocumentsPage() {
  const [shipmentIds, setShipmentIds] = useState('')
  const [loading, setLoading] = useState<AayshPdfType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const getIds = () =>
    shipmentIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

  const handleDownload = async (type: AayshPdfType) => {
    const ids = getIds()
    if (!ids.length) {
      setError('Enter at least one shipment ID')
      return
    }
    try {
      setLoading(type)
      setError(null)
      const { url, blob } = await downloadAirExpressDocument(type, ids)
      if (url) {
        window.open(url, '_blank')
      } else if (blob) {
        const blobUrl = URL.createObjectURL(blob)
        window.open(blobUrl, '_blank')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate document')
    } finally {
      setLoading(null)
    }
  }

  return (
    <AirExpressShell title="Documents" subtitle="Generate labels, manifests, and invoices for shipments.">
      <AirExpressSection
        title="Print documents"
        description="Enter one or more shipment IDs (comma-separated) to generate shipping documents."
      >
        <input
          className={airExpressInputClass}
          value={shipmentIds}
          onChange={(e) => setShipmentIds(e.target.value)}
          placeholder="e.g. 81250661, 81250662"
        />
        {error && <div className="mt-3"><AirExpressErrorBanner message={error} /></div>}
        <div className="flex flex-wrap gap-3 mt-4">
          {(['labels', 'manifests', 'invoices'] as AayshPdfType[]).map((type) => (
            <AirExpressPrimaryButton
              key={type}
              loading={loading === type}
              disabled={loading !== null && loading !== type}
              onClick={() => handleDownload(type)}
            >
              <FileText className="w-4 h-4" />
              Print {type}
            </AirExpressPrimaryButton>
          ))}
        </div>
      </AirExpressSection>
    </AirExpressShell>
  )
}
