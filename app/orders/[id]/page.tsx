'use client'

import { apiFetch } from '@/lib/auth'
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
  shiprocket_order_id?: number | string | null
  shiprocket_meta?: { status?: string | null } | null
  source?: string
}

/** True when courier/AWB is assigned — label / manifest / invoice need this. */
function isOrderShipped(order: ShopifyOrder): boolean {
  const awb = order.fulfillments?.[0]?.tracking_number
  if (awb && String(awb).trim()) return true
  const meta = String(order.shiprocket_meta?.status || '').toLowerCase()
  if (!meta) return false
  if (meta.includes('new') || meta.includes('canceled') || meta.includes('cancelled')) return false
  return (
    meta.includes('pickup') ||
    meta.includes('shipped') ||
    meta.includes('transit') ||
    meta.includes('delivered') ||
    meta.includes('rto') ||
    meta.includes('ofd') ||
    meta.includes('reached')
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Badge({ label, variant = 'default' }: { label: string; variant?: 'green' | 'yellow' | 'red' | 'blue' | 'default' }) {
  const colors = {
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    yellow: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    red: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    default: 'bg-[var(--card-elevated)] text-[var(--foreground-muted)] border-[var(--border)]',
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
  if (['paid', 'fulfilled', 'delivered'].some((v) => s.includes(v))) return 'green'
  if (['pending', 'partial', 'in_transit'].some((v) => s.includes(v))) return 'yellow'
  if (['refunded', 'voided', 'cancelled', 'failed'].some((v) => s.includes(v))) return 'red'
  if (['authorized'].some((v) => s.includes(v))) return 'blue'
  return 'default'
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <Icon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <h2 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
          {title}
        </h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex justify-between gap-4 text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
      <span className="shrink-0" style={{ color: 'var(--foreground-muted)' }}>
        {label}
      </span>
      <span className="text-right break-all" style={{ color: 'var(--foreground)' }}>
        {value}
      </span>
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
        const res = await apiFetch(`/api/shopify/orders/${orderId}`)
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
    const res = await apiFetch(`/api/shiprocket/${type}`, {
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

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar />
        <TopBar />
        <main className="ml-0 lg:ml-64 p-4 lg:p-6">
          <div className="max-w-5xl mx-auto mt-20 flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-purple-600 dark:text-purple-400 animate-spin" />
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                Loading order details...
              </p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Error ──
  if (error || !order) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar />
        <TopBar />
        <main className="ml-0 lg:ml-64 p-4 lg:p-6">
          <div className="max-w-5xl mx-auto mt-20">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 mb-6 text-sm transition-colors hover:opacity-80"
              style={{ color: 'var(--foreground-muted)' }}
            >
              <ArrowLeft className="w-4 h-4" /> Back to Orders
            </button>
            <div className="p-6 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p>{error || 'Order not found'}</p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const shippingCost = order.total_shipping_price_set?.shop_money?.amount
  const shipped = isOrderShipped(order)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <Sidebar />
      <TopBar />
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-5xl mx-auto mt-20">
          {/* ── Back ── */}
          <button
            onClick={() => router.push('/orders')}
            className="flex items-center gap-2 mb-6 text-sm transition-colors hover:opacity-80"
            style={{ color: 'var(--foreground-muted)' }}
          >
            <ArrowLeft className="w-4 h-4" /> Back to Orders
          </button>

          {/* ── Header ── */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold mb-1" style={{ color: 'var(--foreground)' }}>
                {order.name}
              </h1>
              <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                Placed on {new Date(order.created_at).toLocaleString()}
                {order.cancelled_at && (
                  <span className="ml-3 text-red-600 dark:text-red-400">
                    · Cancelled on {new Date(order.cancelled_at).toLocaleString()}
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <Badge label={order.financial_status} variant={statusVariant(order.financial_status)} />
              <Badge label={order.fulfillment_status ?? 'Unfulfilled'} variant={statusVariant(order.fulfillment_status)} />
            </div>
          </div>

          {/* ── Shiprocket actions (only after AWB / shipment assigned) ── */}
          {shipped && (
            <div
              className="rounded-2xl border p-5 mb-6"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <p className="text-xs mb-3 uppercase tracking-wide font-semibold" style={{ color: 'var(--foreground-muted)' }}>
                Shiprocket Documents
              </p>
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
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors capitalize hover:bg-purple-500/10"
                      style={{
                        backgroundColor: 'var(--card-elevated)',
                        borderColor: 'var(--border)',
                        color: 'var(--foreground)',
                      }}
                    >
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                      {isLoading ? `Getting ${type}…` : `Print ${type}`}
                    </button>
                  )
                })}

                <button
                  onClick={handleDownloadAll}
                  disabled={!!actionLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-purple-500/40 bg-purple-600 hover:bg-purple-500 text-sm text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {actionLoading === 'all' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Downloading all…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> Download All
                    </>
                  )}
                </button>
              </div>

              {downloadAllResults && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {downloadAllResults.map((r) => (
                    <span
                      key={r.type}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                        r.status === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                          : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
                      }`}
                      title={r.message}
                    >
                      {r.status === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {r.type}
                      {r.status === 'error' && r.message && (
                        <span className="opacity-70 truncate max-w-[180px]"> — {r.message}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {actionError && (
            <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{actionError}</p>
            </div>
          )}

          {/* ── Grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6">
              <SectionCard title="Items Ordered" icon={ShoppingCart}>
                <div className="space-y-0 divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {order.line_items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 py-3 border-b last:border-0"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                          {item.title}
                        </p>
                        {item.variant_title && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                            {item.variant_title}
                          </p>
                        )}
                        {item.sku && (
                          <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                            SKU: {item.sku}
                          </p>
                        )}
                        {item.vendor && (
                          <p className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                            Vendor: {item.vendor}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                          {order.currency} {item.price} × {item.quantity}
                        </p>
                        {parseFloat(item.total_discount) > 0 && (
                          <p className="text-emerald-600 dark:text-emerald-400 text-xs">−{item.total_discount} discount</p>
                        )}
                        <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
                          {item.fulfillment_status ?? 'Unfulfilled'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t space-y-1.5" style={{ borderColor: 'var(--border)' }}>
                  <Row label="Subtotal" value={`${order.currency} ${order.subtotal_price}`} />
                  {shippingCost && <Row label="Shipping" value={`${order.currency} ${shippingCost}`} />}
                  {parseFloat(order.total_discounts) > 0 && (
                    <Row label="Discounts" value={`−${order.currency} ${order.total_discounts}`} />
                  )}
                  <Row label="Tax" value={`${order.currency} ${order.total_tax}`} />
                  <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      Total
                    </span>
                    <span className="font-bold text-base" style={{ color: 'var(--foreground)' }}>
                      {order.currency} {order.total_price}
                    </span>
                  </div>
                </div>

                {order.discount_codes && order.discount_codes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {order.discount_codes.map((dc) => (
                      <span
                        key={dc.code}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs"
                      >
                        {dc.code} · −{dc.amount}
                      </span>
                    ))}
                  </div>
                )}
              </SectionCard>

              {order.fulfillments && order.fulfillments.length > 0 && (
                <SectionCard title="Fulfillments" icon={Truck}>
                  <div className="space-y-4">
                    {order.fulfillments.map((f) => (
                      <div
                        key={f.id}
                        className="p-4 rounded-xl border space-y-1.5"
                        style={{ backgroundColor: 'var(--card-elevated)', borderColor: 'var(--border)' }}
                      >
                        <Row label="Status" value={<Badge label={f.status} variant={statusVariant(f.status)} />} />
                        <Row label="Shipment Status" value={f.shipment_status ?? '—'} />
                        {f.shipment_status_reason && <Row label="Status Reason" value={f.shipment_status_reason} />}
                        <Row label="Courier" value={f.tracking_company ?? '—'} />
                        <Row label="Tracking #" value={f.tracking_number ?? '—'} />
                        {f.tracking_url && (
                          <Row
                            label="Tracking Link"
                            value={
                              <a
                                href={f.tracking_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-purple-600 dark:text-purple-400 hover:underline text-xs break-all"
                              >
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SectionCard title="Shipping Address" icon={MapPin}>
                  <pre
                    className="text-sm whitespace-pre-wrap font-sans leading-relaxed"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {formatAddress(order.shipping_address)}
                  </pre>
                </SectionCard>
                <SectionCard title="Billing Address" icon={MapPin}>
                  <pre
                    className="text-sm whitespace-pre-wrap font-sans leading-relaxed"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {formatAddress(order.billing_address)}
                  </pre>
                </SectionCard>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <SectionCard title="Customer" icon={User}>
                {order.customer ? (
                  <>
                    <Row
                      label="Name"
                      value={[order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || '—'}
                    />
                    <Row label="Email" value={order.customer.email ?? order.email ?? '—'} />
                    <Row label="Phone" value={order.customer.phone ?? order.phone ?? '—'} />
                    <Row label="Total Orders" value={order.customer.orders_count} />
                    <Row
                      label="Total Spent"
                      value={order.customer.total_spent ? `${order.currency} ${order.customer.total_spent}` : undefined}
                    />
                    <Row label="Verified Email" value={order.customer.verified_email ? 'Yes' : 'No'} />
                  </>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                    Guest checkout
                  </p>
                )}
              </SectionCard>

              <SectionCard title="Payment" icon={CreditCard}>
                <Row
                  label="Status"
                  value={<Badge label={order.financial_status} variant={statusVariant(order.financial_status)} />}
                />
                <Row label="Gateway" value={order.gateway ?? order.payment_gateway_names?.join(', ') ?? '—'} />
                <Row label="Total" value={`${order.currency} ${order.total_price}`} />
                {order.refunds && order.refunds.length > 0 && (
                  <Row label="Refunds" value={`${order.refunds.length} refund(s)`} />
                )}
              </SectionCard>

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
