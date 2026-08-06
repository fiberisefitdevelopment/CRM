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

export default function AirExpressCreateOrderPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    order_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    pickup_location: '',
    consignor_name: '',
    comment: '',
    billing_customer_name: '',
    billing_last_name: '',
    billing_address: '',
    billing_address_2: '',
    billing_city: '',
    billing_pincode: '',
    billing_state: '',
    billing_country: 'India',
    billing_email: '',
    billing_phone: '',
    payment_method: 'COD',
    shipping_charges: '',
    giftwrap_charges: '',
    transaction_charges: '',
    total_discount: '',
    length: '',
    breadth: '',
    height: '',
    weight: '',
  })
  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ ...defaultItem }])

  const subTotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + Number(item.units || 0) * Number(item.selling_price || 0), 0),
    [orderItems],
  )

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const updateItem = (index: number, key: keyof OrderItem, value: string) => {
    setOrderItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const payload = {
        ...form,
        order_items: orderItems.map((item) => ({
          name: item.name,
          sku: item.sku,
          units: Number(item.units),
          selling_price: Number(item.selling_price),
          discount: Number(item.discount || 0),
          tax: Number(item.tax || 0),
          hsn: item.hsn,
        })),
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

      const data = await createAirExpressOrder(payload as any)
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
            <input className={airExpressInputClass} value={form.order_id} onChange={(e) => setField('order_id', e.target.value)} placeholder="Order ID *" required />
            <input className={airExpressInputClass} type="date" value={form.order_date} onChange={(e) => setField('order_date', e.target.value)} />
            <input className={airExpressInputClass} value={form.pickup_location} onChange={(e) => setField('pickup_location', e.target.value)} placeholder="Pickup location *" required />
            <input className={airExpressInputClass} value={form.consignor_name} onChange={(e) => setField('consignor_name', e.target.value)} placeholder="Consignor name" />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.comment} onChange={(e) => setField('comment', e.target.value)} placeholder="Comment" />
          </div>
        </AirExpressSection>

        <AirExpressSection title="Customer" description="Billing and contact information.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={airExpressInputClass} value={form.billing_customer_name} onChange={(e) => setField('billing_customer_name', e.target.value)} placeholder="First name" />
            <input className={airExpressInputClass} value={form.billing_last_name} onChange={(e) => setField('billing_last_name', e.target.value)} placeholder="Last name" />
            <input className={airExpressInputClass} value={form.billing_phone} onChange={(e) => setField('billing_phone', e.target.value)} placeholder="Phone" />
            <input className={airExpressInputClass} type="email" value={form.billing_email} onChange={(e) => setField('billing_email', e.target.value)} placeholder="Email" />
            <input className={`${airExpressInputClass} md:col-span-2`} value={form.billing_address} onChange={(e) => setField('billing_address', e.target.value)} placeholder="Address" />
            <input className={airExpressInputClass} value={form.billing_address_2} onChange={(e) => setField('billing_address_2', e.target.value)} placeholder="Address line 2" />
            <input className={airExpressInputClass} value={form.billing_city} onChange={(e) => setField('billing_city', e.target.value)} placeholder="City" />
            <input className={airExpressInputClass} value={form.billing_state} onChange={(e) => setField('billing_state', e.target.value)} placeholder="State" />
            <input className={airExpressInputClass} value={form.billing_pincode} onChange={(e) => setField('billing_pincode', e.target.value)} placeholder="Pincode" />
            <input className={airExpressInputClass} value={form.billing_country} onChange={(e) => setField('billing_country', e.target.value)} placeholder="Country" />
          </div>
        </AirExpressSection>

        <AirExpressSection
          title="Order items"
          description="At least one line item is required."
          action={
            <button
              type="button"
              onClick={() => setOrderItems((p) => [...p, { ...defaultItem }])}
              className="text-xs font-semibold text-sky-600 hover:text-sky-500 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add item
            </button>
          }
        >
          {orderItems.map((item, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-8 gap-2 mb-2">
              <input className={`${airExpressInputClass} md:col-span-2`} value={item.name} onChange={(e) => updateItem(index, 'name', e.target.value)} placeholder="Name" required />
              <input className={airExpressInputClass} value={item.sku} onChange={(e) => updateItem(index, 'sku', e.target.value)} placeholder="SKU" required />
              <input className={airExpressInputClass} type="number" value={item.units} onChange={(e) => updateItem(index, 'units', e.target.value)} placeholder="Units" required />
              <input className={airExpressInputClass} type="number" value={item.selling_price} onChange={(e) => updateItem(index, 'selling_price', e.target.value)} placeholder="Price" required />
              <input className={airExpressInputClass} type="number" value={item.discount} onChange={(e) => updateItem(index, 'discount', e.target.value)} placeholder="Discount" />
              <input className={airExpressInputClass} type="number" value={item.tax} onChange={(e) => updateItem(index, 'tax', e.target.value)} placeholder="Tax %" />
              <button type="button" onClick={() => setOrderItems((p) => (p.length === 1 ? p : p.filter((_, i) => i !== index)))} className="text-red-500 hover:text-red-400">
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
            <select className={airExpressInputClass} value={form.payment_method} onChange={(e) => setField('payment_method', e.target.value)}>
              <option value="COD">COD</option>
              <option value="Prepaid">Prepaid</option>
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
