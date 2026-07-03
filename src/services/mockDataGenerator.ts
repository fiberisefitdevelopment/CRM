export interface LineItem {
  id: number
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  price: string
  total_discount: string
  fulfillment_status: string | null
}

export interface Address {
  first_name?: string
  last_name?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  country?: string
  zip?: string
  phone?: string
}

export interface ShopifyOrder {
  id: number
  name: string
  created_at: string
  financial_status: string
  fulfillment_status: string | null
  total_price: string
  currency: string
  cancelled_at?: string | null
  customer?: {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
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
    dispatch_date?: string | null
    delivery_date?: string | null
  }>
  source?: string
}

export function generateMockOrders(): ShopifyOrder[] {
  const now = new Date()

  const createPastDate = (daysAgo: number, hoursAgo: number = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    d.setHours(d.getHours() - hoursAgo)
    return d.toISOString()
  }

  const products = [
    { title: 'Fiberise Fit Premium Mat', sku: 'FF-MAT-PREM', price: '1499.00' },
    { title: 'Fiberise Resistance Bands Set', sku: 'FF-BANDS-ELITE', price: '599.00' },
    { title: 'Fiberise Elite Steel Shaker', sku: 'FF-SHAKE-STEEL', price: '799.00' },
    { title: 'Fiberise Ergonomic Dumbbells 5kg', sku: 'FF-DB-5KG', price: '2499.00' },
    { title: 'Fiberise Sports Gym Duffel Bag', sku: 'FF-BAG-DUFFEL', price: '1248.00' },
  ]

  const customers = [
    { first_name: 'Gurpreet', last_name: 'Gill Sohal', email: 'passive4@gmail.com', phone: '9876543210', city: 'Amritsar', state: 'Punjab', zip: '143001' },
    { first_name: 'Shelika', last_name: 'Luthra', email: 'shelika.luthra@gmail.com', phone: '9888765432', city: 'Mumbai', state: 'Maharashtra', zip: '400001' },
    { first_name: 'Eshal', last_name: 'Sukheja', email: 'eshal.suk@yahoo.com', phone: '9777654321', city: 'Delhi', state: 'Delhi', zip: '110001' },
    { first_name: 'Aarav', last_name: 'Sharma', email: 'aarav.sharma@outlook.com', phone: '9666543210', city: 'Bangalore', state: 'Karnataka', zip: '560001' },
    { first_name: 'Diya', last_name: 'Patel', email: 'diya.patel@gmail.com', phone: '9555432109', city: 'Ahmedabad', state: 'Gujarat', zip: '380001' },
    { first_name: 'Rohan', last_name: 'Verma', email: 'rohan.verma@hotmail.com', phone: '9444321098', city: 'Pune', state: 'Maharashtra', zip: '411001' },
    { first_name: 'Ananya', last_name: 'Sen', email: 'ananya.sen@gmail.com', phone: '9333210987', city: 'Kolkata', state: 'West Bengal', zip: '700001' },
    { first_name: 'Kabir', last_name: 'Mehta', email: 'kabir.mehta@gmail.com', phone: '9222109876', city: 'Hyderabad', state: 'Telangana', zip: '500001' },
    { first_name: 'Meera', last_name: 'Nair', email: 'meera.nair@icloud.com', phone: '9111098765', city: 'Kochi', state: 'Kerala', zip: '682001' },
    { first_name: 'Vikram', last_name: 'Singh', email: 'vikram.singh@gmail.com', phone: '9000987654', city: 'Jaipur', state: 'Rajasthan', zip: '302001' },
  ]

  const mockOrders: ShopifyOrder[] = []

  // Generate 25 highly realistic orders
  for (let i = 0; i < 25; i++) {
    const id = 1000 + i
    const name = `#${id}`
    const daysAgo = Math.floor(i / 1.2) // Spans over the last 20 days
    const hoursAgo = (i * 3) % 24
    const created_at = createPastDate(daysAgo, hoursAgo)

    const customer = customers[i % customers.length]
    const numItems = (i % 2) + 1
    const line_items: LineItem[] = []
    let total_price = 0

    for (let j = 0; j < numItems; j++) {
      const prod = products[(i + j) % products.length]
      const qty = (i + j) % 2 === 0 ? 1 : 2
      const priceVal = parseFloat(prod.price)
      const itemVal = priceVal * qty
      total_price += itemVal

      line_items.push({
        id: id * 10 + j,
        title: prod.title,
        variant_title: null,
        sku: prod.sku,
        quantity: qty,
        price: prod.price,
        total_discount: '0.00',
        fulfillment_status: i % 5 === 0 ? null : 'fulfilled',
      })
    }

    // Determine status categories
    // 0: Cancelled
    // 1, 2: Prepaid + Delivered
    // 3: COD + Delivered (COD Settled)
    // 4: COD + RTO (COD Unrealized)
    // 5: Prepaid + In Transit
    // 6: COD + Pickup Scheduled (COD Pending)
    // 7: Unfulfilled (New)
    const category = i % 8

    let financial_status = 'paid'
    let fulfillment_status: string | null = 'fulfilled'
    let cancelled_at: string | null = null
    let fulfillments: ShopifyOrder['fulfillments'] = []

    if (category === 0) {
      financial_status = 'voided'
      fulfillment_status = null
      cancelled_at = createPastDate(daysAgo, hoursAgo + 1)
    } else if (category === 1 || category === 2) {
      financial_status = 'paid'
      fulfillment_status = 'fulfilled'
      const dispatchDate = createPastDate(daysAgo, hoursAgo + 2)
      const deliveryDate = createPastDate(daysAgo - 2 > 0 ? daysAgo - 2 : 0, hoursAgo + 4)
      fulfillments = [{
        id: id * 100,
        status: 'success',
        tracking_number: `SRDLV${9000000000 + i}`,
        tracking_company: 'Delhivery Surface',
        tracking_url: '#',
        shipment_status: 'delivered',
        created_at: dispatchDate,
        dispatch_date: dispatchDate,
        delivery_date: deliveryDate
      }]
    } else if (category === 3) {
      financial_status = 'pending' // COD
      fulfillment_status = 'fulfilled'
      const dispatchDate = createPastDate(daysAgo, hoursAgo + 2)
      const deliveryDate = createPastDate(daysAgo - 2 > 0 ? daysAgo - 2 : 0, hoursAgo + 4)
      fulfillments = [{
        id: id * 100,
        status: 'success',
        tracking_number: `SRSFX${9100000000 + i}`,
        tracking_company: 'Shadowfax Surface',
        tracking_url: '#',
        shipment_status: 'delivered',
        created_at: dispatchDate,
        dispatch_date: dispatchDate,
        delivery_date: deliveryDate
      }]
    } else if (category === 4) {
      financial_status = 'pending' // COD
      fulfillment_status = 'fulfilled'
      const dispatchDate = createPastDate(daysAgo, hoursAgo + 2)
      fulfillments = [{
        id: id * 100,
        status: 'success',
        tracking_number: `SRXPB${9200000000 + i}`,
        tracking_company: 'Xpressbees Air',
        tracking_url: '#',
        shipment_status: 'rto',
        shipment_status_reason: i % 2 === 0 ? 'Customer refused delivery - "Address incorrect"' : 'Seller Requested Future Pick up',
        created_at: dispatchDate,
        dispatch_date: dispatchDate,
        delivery_date: null
      }]
    } else if (category === 5) {
      financial_status = 'paid'
      fulfillment_status = 'fulfilled'
      const dispatchDate = createPastDate(daysAgo, hoursAgo + 1)
      fulfillments = [{
        id: id * 100,
        status: 'success',
        tracking_number: `SREKT${9300000000 + i}`,
        tracking_company: 'Ekart Logistics',
        tracking_url: '#',
        shipment_status: 'in_transit',
        created_at: dispatchDate,
        dispatch_date: dispatchDate,
        delivery_date: null
      }]
    } else if (category === 6) {
      financial_status = 'pending' // COD
      fulfillment_status = 'fulfilled'
      const dispatchDate = createPastDate(daysAgo, hoursAgo + 1)
      fulfillments = [{
        id: id * 100,
        status: 'success',
        tracking_number: `SRDLV${9400000000 + i}`,
        tracking_company: 'Delhivery Surface',
        tracking_url: '#',
        shipment_status: 'pickup_scheduled',
        created_at: dispatchDate,
        dispatch_date: dispatchDate,
        delivery_date: null
      }]
    } else if (category === 7) {
      financial_status = i % 3 === 0 ? 'pending' : 'paid'
      fulfillment_status = null
    }

    mockOrders.push({
      id,
      name,
      created_at,
      financial_status,
      fulfillment_status,
      total_price: total_price.toFixed(2),
      currency: 'INR',
      cancelled_at,
      customer: {
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
      },
      shipping_address: {
        first_name: customer.first_name,
        last_name: customer.last_name,
        address1: `${10 + (i % 50)}, Elite Fitness Lane`,
        address2: `Near Sports Center, ${customer.city}`,
        city: customer.city,
        province: customer.state,
        country: 'India',
        zip: customer.zip,
        phone: customer.phone,
      },
      billing_address: {
        first_name: customer.first_name,
        last_name: customer.last_name,
        address1: `${10 + (i % 50)}, Elite Fitness Lane`,
        address2: `Near Sports Center, ${customer.city}`,
        city: customer.city,
        province: customer.state,
        country: 'India',
        zip: customer.zip,
        phone: customer.phone,
      },
      line_items,
      fulfillments,
    })
  }

  return mockOrders
}
