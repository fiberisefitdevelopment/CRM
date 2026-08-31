'use client'

import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import {
  downloadAirExpressDocument,
  openAirExpressPdf,
} from '@/lib/airExpressApi'
import type { AayshPdfType } from '@/src/services/aayshExpressClient'

const DOCS: Array<{ type: AayshPdfType; label: string }> = [
  { type: 'labels', label: 'Label' },
  { type: 'manifests', label: 'Manifest' },
  { type: 'invoices', label: 'Invoice' },
]

export function AirExpressDocumentsButtons({
  orderIds,
  shipmentIds,
  className,
  onError,
  onSuccess,
}: {
  orderIds?: Array<string | number>
  shipmentIds?: string[]
  className?: string
  onError?: (message: string) => void
  onSuccess?: (type: AayshPdfType) => void
}) {
  const [loading, setLoading] = useState<AayshPdfType | null>(null)

  const handle = async (type: AayshPdfType) => {
    try {
      setLoading(type)
      const { url, filename } = await downloadAirExpressDocument(
        type,
        shipmentIds || [],
        orderIds || [],
      )
      if (url) openAirExpressPdf(url, filename || `aaysh-${type}.pdf`)
      onSuccess?.(type)
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : `Failed to generate ${type}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className || ''}`}>
      {DOCS.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          disabled={loading !== null}
          onClick={() => void handle(type)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
        >
          {loading === type ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
          {loading === type ? `${label}…` : label}
        </button>
      ))}
    </div>
  )
}
