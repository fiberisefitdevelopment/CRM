'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import {
  Loader2,
  ArrowLeft,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  FileBadge2,
  MapPin,
  Package,
  User,
  CreditCard,
  Truck,
  ShoppingCart,
  Download,
  CheckCircle2,
  XCircle,
  Trash2
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LineItem {
  id: number
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  price: string
  total_discount: string
  fulfillment_status: string | null
  product_id: number | null
  variant_id: number | null
  vendor: string | null
  requires_shipping: boolean
}

interface Address {
  first_name?: string
  last_name?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  country?: string
  zip?: string
  phone?: string
  company?: string
}

interface ShopifyOrder {
  id: number
  name: string
  created_at: string
  updated_at: string
  processed_at: string
  financial_status: string
  fulfillment_status: string | null
  total_price: string
  subtotal_price: string
  total_discounts: string
  total_tax: string
  total_shipping_price_set?: { shop_money?: { amount?: string } }
  currency: string
  note: string | null
  tags: string
  email: string | null
  phone: string | null
  gateway: string | null
  payment_gateway_names?: string[]
  cancel_reason: string | null
  cancelled_at: string | null
  closed_at: string | null
  customer?: {
    id: number
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    orders_count?: number
    total_spent?: string
    verified_email?: boolean
  } | null
  shipping_address?: Address | null
  billing_address?: Address | null
  line_items: LineItem[]
  fulfillments?: Array<{
    id: number
    status: string
    tracking_number: string | null
    tracking_company: string | null
    tracking_url: string | null
    shipment_status: string | null
    shipment_status_reason?: string | null
    created_at: string
  }>
  refunds?: Array<{ id: number }>
  discount_codes?: Array<{ code: string; amount: string; type: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Badge({ label, variant = 'default' }: { label: string; variant?: 'green' | 'yellow' | 'red' | 'blue' | 'default' }) {
  const colors = {
    green:   'bg-green-500/15 text-green-300 border-green-500/30',
    yellow:  'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    red:     'bg-red-500/15 text-red-300 border-red-500/30',
    blue:    'bg-blue-500/15 text-blue-300 border-blue-500/30',
    default: 'bg-white/5 text-white/70 border-white/10',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[variant]}`}>
      {label}
    </span>
  )
}

function statusVariant(status: string | null): 'green' | 'yellow' | 'red' | 'blue' | 'default' {
  if (!status) return 'default'
  const s = status.toLowerCase()
  if (['paid', 'fulfilled', 'delivered'].some(v => s.includes(v))) return 'green'
  if (['pending', 'partial', 'in_transit'].some(v => s.includes(v))) return 'yellow'
  if (['refunded', 'voided', 'cancelled', 'failed'].some(v => s.includes(v))) return 'red'
  if (['authorized'].some(v => s.includes(v))) return 'blue'
  return 'default'
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-white/10">
        <Icon className="w-4 h-4 text-purple-400" />
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex justify-between gap-4 text-sm py-1.5 border-b border-white/5 last:border-0">
      <span className="text-white/50 shrink-0">{label}</span>
      <span className="text-white text-right break-all">{value}</span>
    </div>
  )
}

function formatAddress(addr?: Address | null) {
  if (!addr) return 'N/A'
  return [
    [addr.first_name, addr.last_name].filter(Boolean).join(' '),
    addr.company,
    addr.address1,
    addr.address2,
    [addr.city, addr.province, addr.zip].filter(Boolean).join(', '),
    addr.country,
    addr.phone,
  ]
    .filter(Boolean)
    .join('\n')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params?.id as string

  const [order, setOrder] = useState<ShopifyOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<'label' | 'manifest' | 'invoice' | 'all' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [downloadAllResults, setDownloadAllResults] = useState<
    Array<{ type: string; status: 'success' | 'error'; message?: string }> | null
  >(null)

  useEffect(() => {
    if (!orderId) return
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/shopify/orders/${orderId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to fetch order')
        setOrder(data.order)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [orderId])

  const fetchPrintUrl = async (type: 'label' | 'manifest' | 'invoice', orderName: string) => {
    const res = await fetch(`/api/shiprocket/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNames: [orderName] }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Failed to get ${type}`)
    const url = data.labelUrl || data.manifestUrl || data.invoiceUrl
    if (!url) throw new Error(`No ${type} URL returned from Shiprocket`)
    return url as string
  }

  const handlePrint = async (type: 'label' | 'manifest' | 'invoice') => {
    if (!order) return
    try {
      setActionError(null)
      setDownloadAllResults(null)
      setActionLoading(type)
      const url = await fetchPrintUrl(type, order.name)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err: any) {
      setActionError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownloadAll = async () => {
    if (!order) return
    setActionError(null)
    setDownloadAllResults(null)
    setActionLoading('all')

    const types: Array<'label' | 'manifest' | 'invoice'> = ['label', 'manifest', 'invoice']
    const results: Array<{ type: string; status: 'success' | 'error'; message?: string }> = []

    for (const type of types) {
      try {
        const url = await fetchPrintUrl(type, order.name)
        // Small delay between tabs so browsers don't block them
        await new Promise((r) => setTimeout(r, 300))
        window.open(url, '_blank', 'noopener,noreferrer')
        results.push({ type, status: 'success' })
      } catch (err: any) {
        results.push({ type, status: 'error', message: err.message })
      }
    }

    setDownloadAllResults(results)
    setActionLoading(null)
  }

  const [deleting, setDeleting] = useState(false)

  const handleDeleteOrder = async () => {
    if (!window.confirm('Are you sure you want to permanently delete this order?')) return

    try {
      setActionError(null)
      setDeleting(true)
      const res = await fetch(`/api/shopify/orders/${orderId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete order')

      // Redirect back to orders dashboard
      router.push('/orders')
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete order')
    } finally {
      setDeleting(false)
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <TopBar />
        <main className="ml-0 lg:ml-64 p-4 lg:p-6">
          <div className="max-w-5xl mx-auto mt-20 flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
              <p className="text-white/60 text-sm">Loading order details...</p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Error ──
  if (error || !order) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <TopBar />
        <main className="ml-0 lg:ml-64 p-4 lg:p-6">
          <div className="max-w-5xl mx-auto mt-20">
            <button onClick={() => router.back()} className="flex items-center gap-2 text-white/60 hover:text-white mb-6 text-sm">
              <ArrowLeft className="w-4 h-4" /> Back to Orders
            </button>
            <div className="p-6 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p>{error || 'Order not found'}</p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const shippingCost = order.total_shipping_price_set?.shop_money?.amount

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-5xl mx-auto mt-20">

          {/* ── Back ── */}
          <button
            onClick={() => router.push('/orders')}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-6 text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Orders
          </button>

          {/* ── Header ── */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-white mb-1">{order.name}</h1>
              <p className="text-white/50 text-sm">
                Placed on {new Date(order.created_at).toLocaleString()}
                {order.cancelled_at && (
                  <span className="ml-3 text-red-400">
                    · Cancelled on {new Date(order.cancelled_at).toLocaleString()}
                  </span>
                )}
              </p>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-2 items-center">
              <Badge label={order.financial_status} variant={statusVariant(order.financial_status)} />
              <Badge label={order.fulfillment_status ?? 'Unfulfilled'} variant={statusVariant(order.fulfillment_status)} />
              <button
                onClick={handleDeleteOrder}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-2"
              >
                {deleting ? (
                  <Loader2 className="w-3 h-3 animate-spin text-red-300" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 text-red-300" />
                )}
                {deleting ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>

          {/* ── Shiprocket actions ── */}
          <div className="bg-card rounded-2xl border border-white/10 p-5 mb-6">
            <p className="text-white/50 text-xs mb-3 uppercase tracking-wide">Shiprocket Documents</p>
            <div className="flex flex-wrap gap-3">
              {(['label', 'manifest', 'invoice'] as const).map((type) => {
                const icons = { label: FileBadge2, manifest: FileSpreadsheet, invoice: FileText }
                const Icon = icons[type]
                const isLoading = actionLoading === type
                return (
                  <button
                    key={type}
                    onClick={() => handlePrint(type)}
                    disabled={!!actionLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors capitalize"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                    {isLoading ? `Getting ${type}…` : `Print ${type}`}
                  </button>
                )
              })}

              {/* Download All */}
              <button
                onClick={handleDownloadAll}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 border border-purple-500/30 text-sm text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {actionLoading === 'all'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Downloading all…</>
                  : <><Download className="w-4 h-4" /> Download All</>
                }
              </button>
            </div>

            {/* Download All results */}
            {downloadAllResults && (
              <div className="mt-4 flex flex-wrap gap-2">
                {downloadAllResults.map((r) => (
                  <span
                    key={r.type}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                      r.status === 'success'
                        ? 'bg-green-500/10 border-green-500/30 text-green-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-300'
                    }`}
                    title={r.message}
                  >
                    {r.status === 'success'
                      ? <CheckCircle2 className="w-3 h-3" />
                      : <XCircle className="w-3 h-3" />
                    }
                    {r.type}
                    {r.status === 'error' && r.message && (
                      <span className="opacity-70 truncate max-w-[180px]"> — {r.message}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {actionError && (
            <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{actionError}</p>
            </div>
          )}

          {/* ── Grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* LEFT COLUMN ── spans 2 cols */}
            <div className="lg:col-span-2 flex flex-col gap-6">

              {/* Line Items */}
              <SectionCard title="Items Ordered" icon={ShoppingCart}>
                <div className="space-y-0 divide-y divide-white/5">
                  {order.line_items.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{item.title}</p>
                        {item.variant_title && (
                          <p className="text-white/50 text-xs mt-0.5">{item.variant_title}</p>
                        )}
                        {item.sku && <p className="text-white/40 text-xs">SKU: {item.sku}</p>}
                        {item.vendor && <p className="text-white/40 text-xs">Vendor: {item.vendor}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white text-sm">
                          {order.currency} {item.price} × {item.quantity}
                        </p>
                        {parseFloat(item.total_discount) > 0 && (
                          <p className="text-green-400 text-xs">−{item.total_discount} discount</p>
                        )}
                        <p className="text-white/50 text-xs mt-0.5">
                          {item.fulfillment_status ?? 'Unfulfilled'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
                  <Row label="Subtotal" value={`${order.currency} ${order.subtotal_price}`} />
                  {shippingCost && <Row label="Shipping" value={`${order.currency} ${shippingCost}`} />}
                  {parseFloat(order.total_discounts) > 0 && (
                    <Row label="Discounts" value={`−${order.currency} ${order.total_discounts}`} />
                  )}
                  <Row label="Tax" value={`${order.currency} ${order.total_tax}`} />
                  <div className="flex justify-between text-sm pt-2 border-t border-white/10">
                    <span className="text-white font-semibold">Total</span>
                    <span className="text-white font-bold text-base">{order.currency} {order.total_price}</span>
                  </div>
                </div>

                {/* Discount codes */}
                {order.discount_codes && order.discount_codes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {order.discount_codes.map((dc) => (
                      <span key={dc.code} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-300 text-xs">
                        {dc.code} · −{dc.amount}
                      </span>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Fulfillments */}
              {order.fulfillments && order.fulfillments.length > 0 && (
                <SectionCard title="Fulfillments" icon={Truck}>
                  <div className="space-y-4">
                    {order.fulfillments.map((f) => (
                      <div key={f.id} className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <Row label="Status" value={<Badge label={f.status} variant={statusVariant(f.status)} />} />
                        <Row label="Shipment Status" value={f.shipment_status ?? '—'} />
                        {f.shipment_status_reason && (
                          <Row label="Status Reason" value={f.shipment_status_reason} />
                        )}
                        <Row label="Courier" value={f.tracking_company ?? '—'} />
                        <Row label="Tracking #" value={f.tracking_number ?? '—'} />
                        {f.tracking_url && (
                          <Row
                            label="Tracking Link"
                            value={
                              <a href={f.tracking_url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline text-xs break-all">
                                Track Shipment →
                              </a>
                            }
                          />
                        )}
                        <Row label="Created" value={new Date(f.created_at).toLocaleString()} />
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Addresses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SectionCard title="Shipping Address" icon={MapPin}>
                  <pre className="text-white/80 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                    {formatAddress(order.shipping_address)}
                  </pre>
                </SectionCard>
                <SectionCard title="Billing Address" icon={MapPin}>
                  <pre className="text-white/80 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                    {formatAddress(order.billing_address)}
                  </pre>
                </SectionCard>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="flex flex-col gap-6">

              {/* Customer */}
              <SectionCard title="Customer" icon={User}>
                {order.customer ? (
                  <>
                    <Row label="Name" value={[order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || '—'} />
                    <Row label="Email" value={order.customer.email ?? order.email ?? '—'} />
                    <Row label="Phone" value={order.customer.phone ?? order.phone ?? '—'} />
                    <Row label="Total Orders" value={order.customer.orders_count} />
                    <Row label="Total Spent" value={order.customer.total_spent ? `${order.currency} ${order.customer.total_spent}` : undefined} />
                    <Row label="Verified Email" value={order.customer.verified_email ? 'Yes' : 'No'} />
                  </>
                ) : (
                  <p className="text-white/50 text-sm">Guest checkout</p>
                )}
              </SectionCard>

              {/* Payment */}
              <SectionCard title="Payment" icon={CreditCard}>
                <Row label="Status" value={<Badge label={order.financial_status} variant={statusVariant(order.financial_status)} />} />
                <Row label="Gateway" value={order.gateway ?? order.payment_gateway_names?.join(', ') ?? '—'} />
                <Row label="Total" value={`${order.currency} ${order.total_price}`} />
                {order.refunds && order.refunds.length > 0 && (
                  <Row label="Refunds" value={`${order.refunds.length} refund(s)`} />
                )}
              </SectionCard>

              {/* Order Info */}
              <SectionCard title="Order Info" icon={Package}>
                <Row label="Order #" value={order.name} />
                <Row label="Order ID" value={order.id} />
                <Row label="Currency" value={order.currency} />
                <Row label="Tags" value={order.tags || '—'} />
                <Row label="Note" value={order.note ?? '—'} />
                <Row label="Cancel Reason" value={order.cancel_reason ?? '—'} />
                <Row label="Created" value={new Date(order.created_at).toLocaleString()} />
                <Row label="Updated" value={new Date(order.updated_at).toLocaleString()} />
                {order.closed_at && <Row label="Closed" value={new Date(order.closed_at).toLocaleString()} />}
              </SectionCard>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
