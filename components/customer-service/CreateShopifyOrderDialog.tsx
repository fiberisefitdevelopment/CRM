'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react'
import {
  createShopifyCareOrder,
  listShopifyCareProducts,
  type ShopifyCatalogVariant,
} from '@/lib/careTasksApi'

export type CreateOrderPrefill = {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  province?: string | null
  zip?: string | null
  country?: string | null
  note?: string | null
  sourceOrderName?: string | null
}

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

function splitName(full?: string | null): { firstName: string; lastName: string } {
  const parts = String(full || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

type Props = {
  open: boolean
  onClose: () => void
  prefill?: CreateOrderPrefill | null
  agent?: { name?: string | null; email?: string | null } | null
  onCreated?: (result: {
    orderName: string | null
    orderId: number | string | null
    createdBy: { email: string; name: string } | null
  }) => void
}

export function CreateShopifyOrderDialog({
  open,
  onClose,
  prefill,
  agent,
  onCreated,
}: Props) {
  const [variants, setVariants] = useState<ShopifyCatalogVariant[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [productQ, setProductQ] = useState('')
  const [selectedVariantId, setSelectedVariantId] = useState('')

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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createdMeta, setCreatedMeta] = useState<{
    orderName: string | null
    createdByName: string
    createdByEmail: string
  } | null>(null)

  const applyPrefill = useCallback((p?: CreateOrderPrefill | null) => {
    const fromName = splitName(
      [p?.firstName, p?.lastName].filter(Boolean).join(' ') || undefined,
    )
    setFirstName(String(p?.firstName || fromName.firstName || '').trim())
    setLastName(String(p?.lastName || fromName.lastName || '').trim())
    setEmail(String(p?.email || '').trim())
    setPhone(String(p?.phone || '').trim())
    setAddress1(String(p?.address1 || '').trim())
    setAddress2(String(p?.address2 || '').trim())
    setCity(String(p?.city || '').trim())
    setProvince(String(p?.province || '').trim())
    setZip(String(p?.zip || '').trim())
    const noteBits = [
      p?.note?.trim() || '',
      p?.sourceOrderName ? `Reorder / upsell from ${p.sourceOrderName}` : '',
    ].filter(Boolean)
    setNote(noteBits.join('\n'))
    setPayment('cod')
    setLines([{ key: newKey(), variantId: null, label: '', quantity: '1', price: '' }])
    setSelectedVariantId('')
    setProductQ('')
    setError(null)
    setSuccess(null)
    setCreatedMeta(null)
  }, [])

  useEffect(() => {
    if (!open) return
    applyPrefill(prefill)
  }, [open, prefill, applyPrefill])

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
    if (!open) return
    void loadCatalog()
  }, [open, loadCatalog])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      void loadCatalog(productQ.trim() || undefined)
    }, 300)
    return () => window.clearTimeout(t)
  }, [productQ, open, loadCatalog])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, submitting, onClose])

  const estimatedTotal = useMemo(
    () =>
      lines.reduce((sum, row) => {
        const qty = Number(row.quantity) || 0
        const price = Number(row.price) || 0
        return sum + qty * price
      }, 0),
    [lines],
  )

  const agentLabel =
    agent?.name?.trim() ||
    agent?.email?.split('@')[0] ||
    'Care agent'

  const addVariantLine = () => {
    const id = Number(selectedVariantId)
    if (!id) return
    const v = variants.find((x) => x.id === id)
    if (!v) return
    const label =
      v.title && v.title !== 'Default Title'
        ? `${v.productTitle} — ${v.title}`
        : v.productTitle
    setLines((prev) => {
      const next = [
        ...prev.filter((r) => r.variantId || r.label.trim() || r.price.trim()),
        {
          key: newKey(),
          variantId: v.id,
          label,
          quantity: '1',
          price: v.price,
        },
      ]
      return next.filter((r, _i, arr) => {
        if (arr.length > 1 && !r.variantId && !r.label.trim() && !r.price.trim()) return false
        return true
      })
    })
    setSelectedVariantId('')
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
          country: prefill?.country || 'India',
        },
        lineItems,
      })

      const name = result.orderName || (result.orderId ? `#${result.orderId}` : 'Order')
      const byName = result.createdBy?.name || agentLabel
      const byEmail = result.createdBy?.email || agent?.email || ''
      setCreatedMeta({
        orderName: name,
        createdByName: byName,
        createdByEmail: byEmail,
      })
      setSuccess(
        payment === 'cod'
          ? `Created ${name} on Shopify (COD · payment pending)`
          : `Created ${name} on Shopify (marked paid)`,
      )
      onCreated?.({
        orderName: name,
        orderId: result.orderId,
        createdBy: result.createdBy,
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to create order')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-purple-500/30'
  const inputStyle = {
    background: 'var(--background)',
    borderColor: 'var(--border)',
    color: 'var(--foreground)',
  } as const
  const labelClass = 'block text-[11px] font-semibold mb-1'
  const labelStyle = { color: 'var(--foreground-muted)' } as const

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        disabled={submitting}
        onClick={() => !submitting && onClose()}
      />
      <div
        className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border shadow-xl"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-shopify-order-title"
      >
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div>
            <h2
              id="create-shopify-order-title"
              className="text-base font-bold"
              style={{ color: 'var(--foreground)' }}
            >
              Create Shopify order
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
              Customer details prefilled from this order
              {prefill?.sourceOrderName ? ` (${prefill.sourceOrderName})` : ''}.
            </p>
            <p
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: 'var(--foreground-muted)' }}
            >
              <User className="w-3.5 h-3.5" />
              Creating as {agentLabel}
              {agent?.email ? ` · ${agent.email}` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="p-2 rounded-lg border disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
              Customer
            </h3>
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

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
              Shipping
            </h3>
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
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
                Products
              </h3>
              <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
                Est. ₹{estimatedTotal.toLocaleString('en-IN')}
              </span>
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
                className={`${inputClass} sm:max-w-[14rem]`}
                style={inputStyle}
                disabled={catalogLoading}
              >
                <option value="">{catalogLoading ? 'Loading…' : 'Select product…'}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.productTitle}
                    {v.title && v.title !== 'Default Title' ? ` — ${v.title}` : ''}
                    {` · ₹${v.price}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addVariantLine}
                disabled={!selectedVariantId}
                className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            {catalogError && <p className="text-xs text-red-500">{catalogError}</p>}

            <div className="space-y-2">
              {lines.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-12 gap-2 items-end rounded-xl border p-2.5"
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
                      onChange={(e) =>
                        updateLine(row.key, { label: e.target.value, variantId: null })
                      }
                      disabled={Boolean(row.variantId)}
                      placeholder="Custom title"
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
                      disabled={Boolean(row.variantId)}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(row.key)}
                      disabled={lines.length <= 1}
                      className="p-2 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { key: newKey(), variantId: null, label: '', quantity: '1', price: '' },
                ])
              }
              className="text-xs font-semibold underline"
              style={{ color: 'var(--foreground-muted)' }}
            >
              + Add custom line
            </button>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
              Payment & note
            </h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['cod', 'COD'],
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
            <textarea
              className={`${inputClass} min-h-[72px] resize-y`}
              style={inputStyle}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note on Shopify order"
            />
          </section>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {success && createdMeta && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">{success}</p>
                  <p className="text-xs mt-1 opacity-90">
                    Created by <strong>{createdMeta.createdByName}</strong>
                    {createdMeta.createdByEmail ? ` (${createdMeta.createdByEmail})` : ''}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              {success ? 'Close' : 'Cancel'}
            </button>
            {!success && (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackagePlus className="w-4 h-4" />
                )}
                {submitting ? 'Creating…' : 'Create on Shopify'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
