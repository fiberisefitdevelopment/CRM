'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PackagePlus } from 'lucide-react'
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
  cancelAirExpressOrders,
  extractList,
  fetchAirExpressOrders,
} from '@/lib/airExpressApi'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Booked', label: 'Booked' },
  { value: 'Shipped', label: 'Shipped' },
  { value: 'In Transit', label: 'In Transit' },
  { value: 'Out for Delivery', label: 'Out for Delivery' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'RTO', label: 'RTO' },
]

const PAGE_SIZE = 25

export default function AirExpressOrdersPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAirExpressOrders({
        page,
        per_page: PAGE_SIZE,
        search: search || undefined,
        status: status || undefined,
        payment_method: paymentMethod || undefined,
        sort: 'DESC',
      })
      setOrders(extractList(data))
      const meta = (data as any)?.meta?.pagination
      setTotal(Number(meta?.total ?? extractList(data).length))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [page, search, status, paymentMethod])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [search, status, paymentMethod])

  const handleCancel = async (orderId: string) => {
    if (!confirm(`Cancel order ${orderId}?`)) return
    try {
      await cancelAirExpressOrders([orderId])
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  return (
    <AirExpressShell
      title="Orders"
      subtitle="View and manage orders synced from Aaysh Express."
      actions={<AirExpressRefreshButton loading={loading} onClick={load} />}
    >
      <AirExpressFilterBar>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <AirExpressSearchInput
              value={search}
              onChange={setSearch}
              onEnter={load}
              placeholder="Search order ID, AWB, name, phone…"
            />
          </div>
          <AirExpressSelect value={status} onChange={setStatus}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </AirExpressSelect>
          <AirExpressSelect value={paymentMethod} onChange={setPaymentMethod}>
            <option value="">All payments</option>
            <option value="COD">COD</option>
            <option value="Prepaid">Prepaid</option>
          </AirExpressSelect>
        </div>
      </AirExpressFilterBar>

      {error && <AirExpressErrorBanner message={error} />}

      {loading ? (
        <AirExpressLoading label="Loading orders…" />
      ) : orders.length === 0 ? (
        <AirExpressEmptyState
          title="No orders found"
          description="Create a new order or adjust your filters. Orders created in Aaysh Express will appear here."
          action={
            <Link href="/air-express/create-order">
              <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500">
                <PackagePlus className="w-4 h-4" />
                Create Order
              </span>
            </Link>
          }
        />
      ) : (
        <AirExpressSection title="Order list">
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>AWB</th>
                  <th>Payment</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const orderId = order.order_id || order.client_order_id || order.id
                  const shipment = order.shipment || order.shipments?.[0] || {}
                  return (
                    <tr key={String(orderId)}>
                      <td className="font-mono text-xs">{orderId}</td>
                      <td>{order.billing_customer_name || order.customer_name || '—'}</td>
                      <td>{order.billing_phone || order.phone || '—'}</td>
                      <td>
                        <AirExpressStatusBadge status={shipment.status || order.status} />
                      </td>
                      <td className="font-mono text-xs">{shipment.awb || order.awb_code || '—'}</td>
                      <td>{order.payment_method || '—'}</td>
                      <td className="text-right space-x-3">
                        <Link
                          href={`/air-express/orders/${encodeURIComponent(String(orderId))}`}
                          className="text-sky-600 hover:text-sky-500 text-xs font-semibold"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleCancel(String(orderId))}
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
          <AirExpressPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total || orders.length}
            onPageChange={setPage}
          />
        </AirExpressSection>
      )}
    </AirExpressShell>
  )
}
