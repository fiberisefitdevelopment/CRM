'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressEmptyState,
  AirExpressErrorBanner,
  AirExpressFilterBar,
  AirExpressLoading,
  AirExpressPagination,
  AirExpressRefreshButton,
  AirExpressSearchInput,
  AirExpressSection,
  AirExpressSelect,
  AirExpressStatusBadge,
} from '@/components/air-express/ui'
import {
  cancelAirExpressShipments,
  extractList,
  fetchAirExpressShipments,
} from '@/lib/airExpressApi'

const PAGE_SIZE = 25

export default function AirExpressShipmentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shipments, setShipments] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAirExpressShipments({
        page,
        per_page: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
        sort: 'DESC',
      })
      const list = extractList(data, ['data', 'shipments', 'results'])
      setShipments(list)
      const meta = (data as any)?.meta?.pagination
      setTotal(Number(meta?.total ?? list.length))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shipments')
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [search, status])

  const handleCancel = async (awb: string) => {
    if (!awb || !confirm(`Cancel shipment AWB ${awb}?`)) return
    try {
      await cancelAirExpressShipments([awb])
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  return (
    <AirExpressShell
      title="Shipments"
      subtitle="Track AWB assignments and shipment lifecycle."
      actions={<AirExpressRefreshButton loading={loading} onClick={load} />}
    >
      <AirExpressFilterBar>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AirExpressSearchInput
            value={search}
            onChange={setSearch}
            onEnter={load}
            placeholder="Search AWB or order ID…"
          />
          <AirExpressSelect value={status} onChange={setStatus}>
            <option value="">All statuses</option>
            {['Pending', 'Booked', 'Shipped', 'Delivered', 'Cancelled', 'RTO'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </AirExpressSelect>
        </div>
      </AirExpressFilterBar>

      {error && <AirExpressErrorBanner message={error} />}

      {loading ? (
        <AirExpressLoading label="Loading shipments…" />
      ) : shipments.length === 0 ? (
        <AirExpressEmptyState
          title="No shipments found"
          description="Shipments appear here after orders are booked and AWB is assigned."
        />
      ) : (
        <AirExpressSection title="Shipment list">
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Shipment ID</th>
                  <th>Order ID</th>
                  <th>AWB</th>
                  <th>Status</th>
                  <th>Courier</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => {
                  const shipmentId = s.shipment_id || s.id
                  const awb = s.awb || s.awb_code
                  const orderId = s.order_id || s.client_order_id
                  return (
                    <tr key={String(shipmentId)}>
                      <td className="font-mono text-xs">{shipmentId}</td>
                      <td className="font-mono text-xs">{orderId || '—'}</td>
                      <td className="font-mono text-xs">{awb || '—'}</td>
                      <td>
                        <AirExpressStatusBadge status={s.status} />
                      </td>
                      <td>{s.courier_name || '—'}</td>
                      <td className="text-right space-x-3">
                        <Link
                          href={`/air-express/shipments/${encodeURIComponent(String(shipmentId))}`}
                          className="text-sky-600 hover:text-sky-500 text-xs font-semibold"
                        >
                          View
                        </Link>
                        {awb && (
                          <button
                            type="button"
                            onClick={() => handleCancel(String(awb))}
                            className="text-red-500 hover:text-red-400 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <AirExpressPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total || shipments.length}
            onPageChange={setPage}
          />
        </AirExpressSection>
      )}
    </AirExpressShell>
  )
}
