'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressCodeBlock,
  AirExpressErrorBanner,
  AirExpressPrimaryButton,
  AirExpressSection,
} from '@/components/air-express/ui'
import { bulkUploadAirExpressOrders } from '@/lib/airExpressApi'

export default function AirExpressBulkImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)

  const handleUpload = async () => {
    if (!file) {
      setError('Select an Excel file (.xlsx or .xls)')
      return
    }
    try {
      setLoading(true)
      setError(null)
      setResult(null)
      const data = await bulkUploadAirExpressOrders(file)
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AirExpressShell title="Bulk Import" subtitle="Import multiple orders from an Excel file.">
      <AirExpressSection
        title="Upload file"
        description="Upload a supported Excel file (.xlsx / .xls) to create multiple orders at once."
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-sky-600 file:text-white file:font-semibold"
          style={{ color: 'var(--foreground-muted)' }}
        />

        {error && <div className="mt-4"><AirExpressErrorBanner message={error} /></div>}

        <AirExpressPrimaryButton className="mt-4" onClick={handleUpload} loading={loading} disabled={!file}>
          <Upload className="w-4 h-4" />
          Upload & Import
        </AirExpressPrimaryButton>

        {result != null && (
          <div className="mt-4">
            <AirExpressCodeBlock data={result} />
          </div>
        )}
      </AirExpressSection>
    </AirExpressShell>
  )
}
