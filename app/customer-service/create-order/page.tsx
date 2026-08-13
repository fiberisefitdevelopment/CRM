'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SubNav } from '@/components/customer-service/SubNav'
import { ErrorToast } from '@/components/ErrorToast'
import { useAuth } from '@/lib/auth'
import { isCareExecutiveRole } from '@/src/utils/accessControl'
import {
  createShopifyCareOrder,
  listShopifyCareProducts,
  type ShopifyCatalogVariant,
} from '@/lib/careTasksApi'

type LineRow = {
  key: string
  variantId: number | null
  label: string
  quantity: string
  price: string
}

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CareCreateShopifyOrderPage() {
  const { user } = useAuth()
  const isExec = isCareExecutiveRole(user?.role)
  const [variants, setVariants] = useState<ShopifyCatalogVariant[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [productQ, setProductQ] = useState('')

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [payment, setPayment] = useState<'cod' | 'paid'>('cod')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [city, setCity] = useState('')
  const [province, setProvince] = useState('')
  const [zip, setZip] = useState('')

  const [lines, setLines] = useState<LineRow[]>([
    { key: newKey(), variantId: null, label: '', quantity: '1', price: '' },
  ])
  const [selectedVariantId, setSelectedVariantId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createdOrderName, setCreatedOrderName] = useState<string | null>(null)

  const loadCatalog = useCallback(async (q?: string) => {
    try {
      setCatalogLoading(true)
      setCatalogError(null)
      const data = await listShopifyCareProducts(q)
      setVariants(data.variants)
    } catch (err: any) {
      setCatalogError(err?.message || 'Failed to load products')
      setVariants([])
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadCatalog(productQ.trim() || undefined)
    }, 300)
    return () => window.clearTimeout(t)
  }, [productQ, loadCatalog])

  const estimatedTotal = useMemo(
    () =>
      lines.reduce((sum, row) => {
        const qty = Number(row.quantity) || 0
        const price = Number(row.price) || 0
        return sum + qty * price
      }, 0),
    [lines],
  )

  const addVariantLine = () => {
    const id = Number(selectedVariantId)
    if (!id) return
    const v = variants.find((x) => x.id === id)
    if (!v) return
    const label =
      v.title && v.title !== 'Default Title'
        ? `${v.productTitle} — ${v.title}`
        : v.productTitle
    setLines((prev) => [
      ...prev.filter((r) => r.variantId || r.label.trim() || r.price.trim()),
      {
        key: newKey(),
        variantId: v.id,
        label,
        quantity: '1',
        price: v.price,
      },
    ].filter((r, i, arr) => {
      // drop empty starter row when first real item added
      if (arr.length > 1 && !r.variantId && !r.label.trim() && !r.price.trim()) return false
      return true
    }))
    setSelectedVariantId('')
  }

  const addCustomLine = () => {
    setLines((prev) => [
      ...prev,
      { key: newKey(), variantId: null, label: '', quantity: '1', price: '' },
    ])
  }

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSubmitting(true)
      setError(null)
      setSuccess(null)
      setCreatedOrderName(null)

      const lineItems = lines
        .map((r) => ({
          variantId: r.variantId,
          title: r.variantId ? undefined : r.label.trim(),
          quantity: Math.max(1, Math.floor(Number(r.quantity) || 1)),
          price: r.variantId ? undefined : r.price.trim(),
        }))
        .filter((r) => r.variantId || (r.title && r.price))

      if (!lineItems.length) throw new Error('Add at least one product or custom item')
      if (!firstName.trim()) throw new Error('First name is required')
      if (!phone.trim()) throw new Error('Phone is required')
      if (!address1.trim() || !city.trim() || !province.trim() || !zip.trim()) {
        throw new Error('Full shipping address is required')
      }

      const result = await createShopifyCareOrder({
        email: email.trim() || undefined,
        phone: phone.trim(),
        note: note.trim() || undefined,
        payment,
        shipping: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          address1: address1.trim(),
          address2: address2.trim() || undefined,
          city: city.trim(),
          province: province.trim(),
          zip: zip.trim(),
          country: 'India',
        },
        lineItems,
      })

      const name = result.orderName || (result.orderId ? `#${result.orderId}` : 'Order')
      setCreatedOrderName(name)
      setSuccess(
        payment === 'cod'
          ? `Created ${name} on Shopify (COD · payment pending)`
          : `Created ${name} on Shopify (marked paid)`,
      )
      setLines([{ key: newKey(), variantId: null, label: '', quantity: '1', price: '' }])
      setNote('')
    } catch (err: any) {
      setError(err?.message || 'Failed to create order')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full px-3 py-2.5 rounded-xl text-sm border outline-none focus:ring-2 focus:ring-purple-500/30'
  const inputStyle = {
    background: 'var(--card)',
    borderColor: 'var(--border)',
    color: 'var(--foreground)',
  } as const
  const labelClass = 'block text-xs font-semibold mb-1.5'
  const labelStyle = { color: 'var(--foreground-muted)' } as const

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <Sidebar />
      <TopBar />
      <main className="lg:ml-64 pt-16 min-h-screen">
        <div className="p-4 md:p-6 max-w-4xl mx-auto">
          {!isExec && <SubNav />}

          <div className="mb-6">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
              Create Shopify Order
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--foreground-muted)' }}>
              Place a live order on Shopify for an upsell / reorder. COD creates the order with
              payment pending.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <section
              className="rounded-2xl border p-5 space-y-4"
              style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
            >
              <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                Customer
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} style={labelStyle}>
                    First name *
                  </label>
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} style={labelStyle}>
                    Last name
                  </label>
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass} style={labelStyle}>
                    Phone *
                  </label>
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="10-digit mobile"
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} style={labelStyle}>
                    Email
                  </label>
                  <input
                    type="email"
                    className={inputClass}
                    style={inputStyle}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section
              className="rounded-2xl border p-5 space-y-4"
              style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
            >
              <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                Shipping address
              </h2>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className={labelClass} style={labelStyle}>
                    Address line 1 *
                  </label>
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={address1}
                    onChange={(e) => setAddress1(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} style={labelStyle}>
                    Address line 2
                  </label>
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={address2}
                    onChange={(e) => setAddress2(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass} style={labelStyle}>
                      City *
                    </label>
                    <input
                      className={inputClass}
                      style={inputStyle}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} style={labelStyle}>
                      State *
                    </label>
                    <input
                      className={inputClass}
                      style={inputStyle}
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass} style={labelStyle}>
                      Pincode *
                    </label>
                    <input
                      className={inputClass}
                      style={inputStyle}
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>
            </section>

            <section
              className="rounded-2xl border p-5 space-y-4"
              style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                  Products
                </h2>
                <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
                  Est. ₹{estimatedTotal.toLocaleString('en-IN')}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--foreground-muted)' }}
                  />
                  <input
                    value={productQ}
                    onChange={(e) => setProductQ(e.target.value)}
                    placeholder="Search catalog…"
                    className={`${inputClass} pl-9`}
                    style={inputStyle}
                  />
                </div>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  className={`${inputClass} sm:max-w-xs`}
                  style={inputStyle}
                  disabled={catalogLoading}
                >
                  <option value="">
                    {catalogLoading ? 'Loading products…' : 'Select product…'}
                  </option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.productTitle}
                      {v.title && v.title !== 'Default Title' ? ` — ${v.title}` : ''}
                      {` · ₹${v.price}`}
                      {v.sku ? ` · ${v.sku}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addVariantLine}
                  disabled={!selectedVariantId}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
              {catalogError && (
                <p className="text-xs text-red-500">{catalogError}</p>
              )}

              <div className="space-y-2">
                {lines.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-12 gap-2 items-end rounded-xl border p-3"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="col-span-12 sm:col-span-6">
                      <label className={labelClass} style={labelStyle}>
                        Item
                      </label>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={row.label}
                        onChange={(e) => updateLine(row.key, { label: e.target.value, variantId: null })}
                        placeholder={row.variantId ? 'Catalog item' : 'Custom title'}
                        disabled={Boolean(row.variantId)}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className={labelClass} style={labelStyle}>
                        Qty
                      </label>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={row.quantity}
                        onChange={(e) => updateLine(row.key, { quantity: e.target.value })}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-3">
                      <label className={labelClass} style={labelStyle}>
                        Price
                      </label>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={row.price}
                        onChange={(e) => updateLine(row.key, { price: e.target.value })}
                        inputMode="decimal"
                        disabled={Boolean(row.variantId)}
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex justify-end pb-0.5">
                      <button
                        type="button"
                        onClick={() => removeLine(row.key)}
                        className="p-2 rounded-lg border disabled:opacity-40"
                        style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                        disabled={lines.length <= 1}
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addCustomLine}
                className="text-xs font-semibold underline"
                style={{ color: 'var(--foreground-muted)' }}
              >
                + Add custom line (no catalog variant)
              </button>
            </section>

            <section
              className="rounded-2xl border p-5 space-y-4"
              style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
            >
              <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                Payment & note
              </h2>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['cod', 'COD (payment pending)'],
                    ['paid', 'Already paid'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPayment(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                      payment === key ? 'bg-purple-600 text-white border-purple-500' : ''
                    }`}
                    style={
                      payment === key
                        ? undefined
                        : {
                            borderColor: 'var(--border)',
                            color: 'var(--foreground)',
                            background: 'var(--background)',
                          }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>
                  Order note
                </label>
                <textarea
                  className={`${inputClass} min-h-[80px] resize-y`}
                  style={inputStyle}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Upsell from care call, pack preference, etc."
                />
              </div>
            </section>

            {success && (
              <div
                className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">{success}</p>
                  {createdOrderName && (
                    <p className="text-xs mt-1 opacity-80">
                      Order is live in Shopify Admin as {createdOrderName}.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackagePlus className="w-4 h-4" />
                )}
                {submitting ? 'Creating on Shopify…' : 'Create order on Shopify'}
              </button>
            </div>
          </form>
        </div>
      </main>

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  )
}
