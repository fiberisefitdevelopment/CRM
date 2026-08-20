'use client'

import { useMemo, useState } from 'react'
import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { AirExpressShell } from '@/components/air-express/AirExpressShell'
import {
  AirExpressErrorBanner,
  AirExpressPrimaryButton,
  AirExpressSection,
  AirExpressSuccessBanner,
  airExpressInputClass,
} from '@/components/air-express/ui'
import { createAirExpressOrder } from '@/lib/airExpressApi'
import type { AayshCreateOrderPayload } from '@/src/services/aayshExpressClient'

type LineItem = {
  title: string
  sku: string
  quantity: string
  price: string
  discount: string
  tax: string
  hsn: string
}

const defaultItem: LineItem = {
  title: '',
  sku: '',
  quantity: '1',
  price: '',
  discount: '',
  tax: '',
  hsn: '',
}

const emptyShipping = {
  firstName: '',
  lastName: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  province: '',
  zip: '',
  country: 'India',
}

export default function AirExpressCreateOrderPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    order_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    pickup_location: '',
    consignor_name: '',
    email: '',
    phone: '',
    note: '',
    payment: 'cod' as 'cod' | 'paid',
    shipping: { ...emptyShipping },
    shipping_charges: '',
    giftwrap_charges: '',
    transaction_charges: '',
    total_discount: '',
    length: '',
    breadth: '',
    height: '',
    weight: '',
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...defaultItem }])

  const subTotal = useMemo(
    () =>
      lineItems.reduce(
        (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
        0,
      ),
    [lineItems],
  )

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const setShippingField = (key: keyof typeof emptyShipping, value: string) => {
    setForm((prev) => {
      const shipping = { ...prev.shipping, [key]: value }
      const next = { ...prev, shipping }
      if (key === 'phone') next.phone = value
      return next
    })
  }

  const updateItem = (index: number, key: keyof LineItem, value: string) => {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const payload: AayshCreateOrderPayload = {
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || form.shipping.phone.trim(),
        note: form.note.trim() || undefined,
        payment: form.payment,
        shipping: {
          ...form.shipping,
          phone: form.phone.trim() || form.shipping.phone.trim(),
        },
        lineItems: lineItems.map((item) => ({
          title: item.title.trim(),
          sku: item.sku.trim(),
          quantity: Number(item.quantity) || 1,
          price: item.price.trim(),
          discount: Number(item.discount || 0),
          tax: Number(item.tax || 0),
          hsn: item.hsn,
        })),
        pickup_location: form.pickup_location.trim(),
        order_id: form.order_id.trim() || undefined,
        order_date: form.order_date,
        consignor_name: form.consignor_name.trim() || undefined,
        sub_total: subTotal,
        shipping_charges: Number(form.shipping_charges || 0),
        giftwrap_charges: Number(form.giftwrap_charges || 0),
        transaction_charges: Number(form.transaction_charges || 0),
        total_discount: Number(form.total_discount || 0),
        weight: Number(form.weight || 0),
        length: Number(form.length || 0),
        breadth: Number(form.breadth || 0),
        height: Number(form.height || 0),
      }

      const data = await createAirExpressOrder(payload)
      const shipmentId = (data as any)?.shipment_id || (data as any)?.data?.shipment_id
      setSuccess(
        shipmentId ? `Order created. Shipment ID: ${shipmentId}` : 'Order created successfully.',
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create order')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AirExpressShell title="Create Order" subtitle="Create a custom order in Aaysh Express.">
      {error && <AirExpressErrorBanner message={error} />}
      {success && <AirExpressSuccessBanner message={success} />}

      <form onSubmit={handleSubmit} className="space-y-5">
        <AirExpressSection title="Order info" description="Basic order and pickup details.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={airExpressInputClass} value={form.order_id} onChange={(e) => setField('order_id', e.target.value)} placeholder="Order ID" />
            <input className={airExpressInputClass} type="date" value={form.order_date} onChange={(e) => setField('order_date', e.target.value)} />
            <input className={airExpressInputClass} value={form.pickup_location} onChange={(e) => setField('pickup_location', e.target.value)} placeholder="Pickup location *" required />
            <input className={airExpressInputClass} value={form.consignor_name} onChange={(e) => setField('consignor_name', e.target.value)} placeholder="Consignor name" />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.note} onChange={(e) => setField('note', e.target.value)} placeholder="Note" />
          </div>
        </AirExpressSection>

        <AirExpressSection title="Customer" description="Shipping and contact (Shopify schema).">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={airExpressInputClass} value={form.shipping.firstName} onChange={(e) => setShippingField('firstName', e.target.value)} placeholder="First name *" required />
            <input className={airExpressInputClass} value={form.shipping.lastName} onChange={(e) => setShippingField('lastName', e.target.value)} placeholder="Last name" />
            <input className={airExpressInputClass} value={form.phone || form.shipping.phone} onChange={(e) => setShippingField('phone', e.target.value)} placeholder="Phone *" required />
            <input className={airExpressInputClass} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="Email" />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.shipping.address1} onChange={(e) => setShippingField('address1', e.target.value)} placeholder="Address *" required />
            <input className={airExpressInputClass} value={form.shipping.address2} onChange={(e) => setShippingField('address2', e.target.value)} placeholder="Address line 2" />
            <input className={airExpressInputClass} value={form.shipping.city} onChange={(e) => setShippingField('city', e.target.value)} placeholder="City *" required />
            <input className={airExpressInputClass} value={form.shipping.province} onChange={(e) => setShippingField('province', e.target.value)} placeholder="State / Province *" required />
            <input className={airExpressInputClass} value={form.shipping.zip} onChange={(e) => setShippingField('zip', e.target.value)} placeholder="Pincode / ZIP *" required />
            <input className={airExpressInputClass} value={form.shipping.country} onChange={(e) => setShippingField('country', e.target.value)} placeholder="Country" />
          </div>
        </AirExpressSection>

        <AirExpressSection
          title="Line items"
          description="At least one line item is required."
          action={
            <button
              type="button"
              onClick={() => setLineItems((p) => [...p, { ...defaultItem }])}
              className="text-xs font-semibold text-sky-600 hover:text-sky-500 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add item
            </button>
          }
        >
          {lineItems.map((item, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-8 gap-2 mb-2">
              <input className={`${airExpressInputClass} md:col-span-2`} value={item.title} onChange={(e) => updateItem(index, 'title', e.target.value)} placeholder="Title *" required />
              <input className={airExpressInputClass} value={item.sku} onChange={(e) => updateItem(index, 'sku', e.target.value)} placeholder="SKU" />
              <input className={airExpressInputClass} type="number" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} placeholder="Qty *" required />
              <input className={airExpressInputClass} type="number" value={item.price} onChange={(e) => updateItem(index, 'price', e.target.value)} placeholder="Price *" required />
              <input className={airExpressInputClass} type="number" value={item.discount} onChange={(e) => updateItem(index, 'discount', e.target.value)} placeholder="Discount" />
              <input className={airExpressInputClass} type="number" value={item.tax} onChange={(e) => updateItem(index, 'tax', e.target.value)} placeholder="Tax %" />
              <button type="button" onClick={() => setLineItems((p) => (p.length === 1 ? p : p.filter((_, i) => i !== index)))} className="text-red-500 hover:text-red-400">
                <Trash2 className="w-4 h-4 mx-auto" />
              </button>
            </div>
          ))}
          <p className="text-xs mt-2" style={{ color: 'var(--foreground-muted)' }}>
            Sub-total: ₹{subTotal.toLocaleString('en-IN')}
          </p>
        </AirExpressSection>

        <AirExpressSection title="Payment & package" description="Payment method and parcel dimensions.">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select className={airExpressInputClass} value={form.payment} onChange={(e) => setField('payment', e.target.value)}>
              <option value="cod">COD</option>
              <option value="paid">Prepaid</option>
            </select>
            <input className={airExpressInputClass} type="number" value={form.weight} onChange={(e) => setField('weight', e.target.value)} placeholder="Weight (kg)" />
            <input className={airExpressInputClass} type="number" value={form.length} onChange={(e) => setField('length', e.target.value)} placeholder="Length (cm)" />
            <input className={airExpressInputClass} type="number" value={form.breadth} onChange={(e) => setField('breadth', e.target.value)} placeholder="Breadth (cm)" />
            <input className={airExpressInputClass} type="number" value={form.height} onChange={(e) => setField('height', e.target.value)} placeholder="Height (cm)" />
            <input className={airExpressInputClass} type="number" value={form.shipping_charges} onChange={(e) => setField('shipping_charges', e.target.value)} placeholder="Shipping charges" />
          </div>
        </AirExpressSection>

        <AirExpressPrimaryButton type="submit" loading={loading}>
          <PackagePlus className="w-4 h-4" />
          Create Order
        </AirExpressPrimaryButton>
      </form>
    </AirExpressShell>
  )
}
