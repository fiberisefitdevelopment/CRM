'use client'

import { apiFetch } from '@/lib/auth'
import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { AlertCircle, CheckCircle2, Loader2, PackagePlus, Plus, Trash2 } from 'lucide-react'

type OrderItem = {
  name: string
  sku: string
  units: string
  selling_price: string
  discount: string
  tax: string
  hsn: string
}

const defaultItem: OrderItem = {
  name: '',
  sku: '',
  units: '',
  selling_price: '',
  discount: '',
  tax: '',
  hsn: '',
}

export default function ShiprocketCreateOrderPage() {
  const inputClassName =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-purple-400/60'
  const sectionClassName = 'bg-card rounded-2xl border border-white/10 p-5'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [form, setForm] = useState({
    order_id: '',
    order_date: '',
    pickup_location: 'Primary',
    comment: '',
    billing_customer_name: '',
    billing_last_name: '',
    billing_address: '',
    billing_address_2: '',
    billing_city: '',
    billing_pincode: '',
    billing_state: '',
    billing_country: '',
    billing_email: '',
    billing_phone: '',
    shipping_is_billing: true,
    payment_method: '',
    shipping_charges: '',
    giftwrap_charges: '',
    transaction_charges: '',
    total_discount: '',
    length: '',
    breadth: '',
    height: '',
    weight: '',
    is_test_order: false,
  })
  const [orderItems, setOrderItems] = useState<OrderItem[]>([defaultItem])
  const starterPackDimensions = {
    weight: '0.6',
    length: '24',
    breadth: '24',
    height: '7',
  }

  const getStarterPackItem = (): OrderItem => ({
    name: 'Starter Pack',
    sku: `ST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    units: '1',
    selling_price: '2499',
    discount: '0',
    tax: '',
    hsn: '',
  })

  const subTotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + Number(item.units) * Number(item.selling_price), 0),
    [orderItems],
  )

  const setField = (key: string, value: string | number | boolean) => {
    setForm((prev: any) => ({ ...prev, [key]: value }))
  }

  const updateItem = (index: number, key: keyof OrderItem, value: string | number) => {
    setOrderItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    )
  }

  const addItem = () => setOrderItems((prev) => [...prev, { ...defaultItem }])
  const addStarterPack = () => {
    setOrderItems((prev) => [...prev, getStarterPackItem()])
    setForm((prev) => ({ ...prev, ...starterPackDimensions }))
  }

  const removeItem = (index: number) =>
    setOrderItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const payload = {
        ...form,
        billing_pincode: Number(form.billing_pincode),
        billing_phone: String(form.billing_phone),
        shipping_is_billing: Boolean(form.shipping_is_billing),
        order_items: orderItems.map((item) => ({
          ...item,
          units: Number(item.units),
          selling_price: Number(item.selling_price),
          discount: Number(item.discount),
          tax: Number(item.tax),
          hsn: Number(item.hsn),
        })),
        sub_total: Number(subTotal),
        shipping_charges: Number(form.shipping_charges),
        giftwrap_charges: Number(form.giftwrap_charges),
        transaction_charges: Number(form.transaction_charges),
        total_discount: Number(form.total_discount),
        length: Number(form.length),
        breadth: Number(form.breadth),
        height: Number(form.height),
        weight: Number(form.weight),
      }

      const res = await apiFetch('/api/shiprocket/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to create Shiprocket order')

      setSuccess('Shiprocket order created successfully.')
    } catch (err: any) {
      setError(err.message || 'Failed to create Shiprocket order')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-6xl mx-auto mt-20">
          <div className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2 flex items-center gap-2">
              <PackagePlus className="w-7 h-7 text-purple-400" />
              Create Shiprocket Order
            </h1>
            <p className="text-white/60 text-sm">Single Order • Domestic Order</p>
          </div>

          {(error || success) && (
            <div
              className={`mb-4 p-4 rounded-xl border text-sm flex items-start gap-2 ${
                error
                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {error ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 mt-0.5" />}
              <p>{error || success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className={sectionClassName}>
              <p className="text-white font-semibold mb-3">Pickup Address</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  className={`${inputClassName} cursor-not-allowed opacity-70`}
                  value={form.pickup_location}
                  placeholder="Pickup Location (e.g. Primary)"
                  readOnly
                  required
                />
                <input className={inputClassName} value={form.order_id} onChange={(e) => setField('order_id', e.target.value)} placeholder="Order ID (e.g. 224-447)" required />
                <input className={inputClassName} value={form.order_date} onChange={(e) => setField('order_date', e.target.value)} placeholder="Order Date (YYYY-MM-DD HH:mm)" required />
              </div>
              <input
                className={`${inputClassName} mt-3`}
                value={form.comment}
                onChange={(e) => setField('comment', e.target.value)}
                placeholder="Comment (optional, e.g. reseller note)"
              />
            </div>

            <div className={sectionClassName}>
              <p className="text-white font-semibold">Delivery Details</p>
              <p className="text-xs text-white/60 mb-3">
                Enter the buyer details to create this order.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input className={inputClassName} value={form.billing_phone} onChange={(e) => setField('billing_phone', e.target.value)} placeholder="Mobile Number" required />
                <input className={inputClassName} value={form.billing_customer_name} onChange={(e) => setField('billing_customer_name', e.target.value)} placeholder="Full Name" required />
                <input className={inputClassName} value={form.billing_last_name} onChange={(e) => setField('billing_last_name', e.target.value)} placeholder="Last Name (optional)" />
                <input className={inputClassName} type="email" value={form.billing_email} onChange={(e) => setField('billing_email', e.target.value)} placeholder="Email" required />
                <input className={`${inputClassName} md:col-span-4`} value={form.billing_address} onChange={(e) => setField('billing_address', e.target.value)} placeholder="Complete Address" required />
                <input className={`${inputClassName} md:col-span-2`} value={form.billing_address_2} onChange={(e) => setField('billing_address_2', e.target.value)} placeholder="Landmark / Address 2 (optional)" />
                <input className={inputClassName} type="number" value={form.billing_pincode} onChange={(e) => setField('billing_pincode', e.target.value)} placeholder="Pincode" required />
                <input className={inputClassName} value={form.billing_city} onChange={(e) => setField('billing_city', e.target.value)} placeholder="City" required />
                <input className={inputClassName} value={form.billing_state} onChange={(e) => setField('billing_state', e.target.value)} placeholder="State" required />
                <input className={inputClassName} value={form.billing_country} onChange={(e) => setField('billing_country', e.target.value)} placeholder="Country" required />
              </div>
              <label className="mt-3 inline-flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={form.shipping_is_billing}
                  onChange={(e) => setField('shipping_is_billing', e.target.checked)}
                  className="rounded border-white/20 bg-white/10"
                />
                Billing details are same as delivery details
              </label>
            </div>

            <div className={sectionClassName}>
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-semibold">Product Templates</p>
                <button
                  type="button"
                  onClick={addStarterPack}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-purple-400/40 text-purple-100 hover:bg-purple-500/20"
                >
                  <Plus className="w-3 h-3" />
                  Add Starter Pack
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                Starter Pack • Price: 2499 • Weight: 0.6 kg • Size: 24 x 24 x 7 cm
              </div>
            </div>

            <div className={sectionClassName}>
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-semibold">Product Details</p>
                <button type="button" onClick={addItem} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-white/20 text-white/80 hover:bg-white/10">
                  <Plus className="w-3 h-3" />
                  Add Another Product
                </button>
              </div>
              {orderItems.map((item, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-9 gap-2 mt-3">
                  <select
                    className={`${inputClassName} md:col-span-2`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value === 'starter_pack') {
                        const presetItem = getStarterPackItem()
                        setOrderItems((prev) =>
                          prev.map((existingItem, i) =>
                            i === index ? { ...existingItem, ...presetItem } : existingItem,
                          ),
                        )
                        setForm((prev) => ({ ...prev, ...starterPackDimensions }))
                      }
                    }}
                  >
                    <option value="" className="bg-slate-900">
                      Select Product Template
                    </option>
                    <option value="starter_pack" className="bg-slate-900">
                      Starter Pack
                    </option>
                  </select>
                  <input className={`${inputClassName} md:col-span-2`} value={item.name} onChange={(e) => updateItem(index, 'name', e.target.value)} placeholder="Product Name" required />
                  <input className={inputClassName} value={item.sku} onChange={(e) => updateItem(index, 'sku', e.target.value)} placeholder="SKU" required />
                  <input className={inputClassName} type="number" value={item.selling_price} onChange={(e) => updateItem(index, 'selling_price', e.target.value)} placeholder="Unit Price" required />
                  <input className={inputClassName} type="number" value={item.units} onChange={(e) => updateItem(index, 'units', e.target.value)} placeholder="Units" required />
                  <input className={inputClassName} type="number" value={item.tax} onChange={(e) => updateItem(index, 'tax', e.target.value)} placeholder="Tax %" />
                  <input className={inputClassName} type="number" value={item.hsn} onChange={(e) => updateItem(index, 'hsn', e.target.value)} placeholder="HSN" />
                  <button type="button" onClick={() => removeItem(index)} className="inline-flex items-center justify-center px-2 py-1 text-xs rounded-md border border-red-400/30 text-red-300 hover:bg-red-500/10">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <details className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <summary className="cursor-pointer text-sm text-white/85 select-none">
                  Additional Charges
                </summary>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                  <input className={inputClassName} type="number" value={form.shipping_charges} onChange={(e) => setField('shipping_charges', e.target.value)} placeholder="Shipping Charges" />
                  <input className={inputClassName} type="number" value={form.giftwrap_charges} onChange={(e) => setField('giftwrap_charges', e.target.value)} placeholder="Giftwrap Charges" />
                  <input className={inputClassName} type="number" value={form.transaction_charges} onChange={(e) => setField('transaction_charges', e.target.value)} placeholder="Transaction Charges" />
                  <input className={inputClassName} type="number" value={form.total_discount} onChange={(e) => setField('total_discount', e.target.value)} placeholder="Total Discount" />
                </div>
              </details>
              <p className="text-xs text-white/60 mt-2">Sub-total for products: {subTotal}</p>
            </div>

            <div className={sectionClassName}>
              <p className="text-white text-sm font-semibold mb-3">Payment Method</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label
                  className={`rounded-lg border px-4 py-3 text-sm cursor-pointer transition-colors ${
                    form.payment_method === 'COD'
                      ? 'border-purple-400/50 bg-purple-500/20 text-purple-100'
                      : 'border-white/10 bg-white/5 text-white/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment_method"
                    className="mr-2"
                    checked={form.payment_method === 'COD'}
                    onChange={() => setField('payment_method', 'COD')}
                  />
                  Cash on Delivery
                </label>
                <label
                  className={`rounded-lg border px-4 py-3 text-sm cursor-pointer transition-colors ${
                    form.payment_method === 'Prepaid'
                      ? 'border-purple-400/50 bg-purple-500/20 text-purple-100'
                      : 'border-white/10 bg-white/5 text-white/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment_method"
                    className="mr-2"
                    checked={form.payment_method === 'Prepaid'}
                    onChange={() => setField('payment_method', 'Prepaid')}
                  />
                  Prepaid
                </label>
              </div>
            </div>

            <div className={sectionClassName}>
              <p className="text-white text-sm font-semibold mb-1">Package Details</p>
              <p className="text-xs text-white/60 mb-3">
                Dimensions are in cm, weight is in kg.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <input className={inputClassName} type="number" step="0.01" value={form.weight} onChange={(e) => setField('weight', e.target.value)} placeholder="Dead Weight (kg)" required />
                <input className={inputClassName} type="number" value={form.length} onChange={(e) => setField('length', e.target.value)} placeholder="Length (cm)" required />
                <input className={inputClassName} type="number" value={form.breadth} onChange={(e) => setField('breadth', e.target.value)} placeholder="Breadth (cm)" required />
                <input className={inputClassName} type="number" value={form.height} onChange={(e) => setField('height', e.target.value)} placeholder="Height (cm)" required />
                <input className={inputClassName} type="number" value={subTotal} placeholder="Sub Total" readOnly />
              </div>
            </div>

            <div className={sectionClassName}>
              <p className="text-white text-sm font-semibold mb-3">Order Classification</p>
              <label className="inline-flex items-center gap-2.5 text-xs text-white/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_test_order}
                  onChange={(e) => setField('is_test_order', e.target.checked)}
                  className="rounded border-white/20 bg-white/10 text-purple-600 focus:ring-0 focus:ring-offset-0"
                />
                Mark as Test Order (prevents real Shiprocket booking & hides from Sales Dashboard)
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-sm text-purple-100 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
              Create Order
            </button>
          </form>

        </div>
      </main>
    </div>
  )
}
