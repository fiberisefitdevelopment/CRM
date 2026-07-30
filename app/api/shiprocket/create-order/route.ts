import { NextRequest, NextResponse } from 'next/server'
import { createShiprocketAdhocOrder } from '@/src/services/shiprocketClient'
import { storePhone, storePhoneByChannel } from '@/src/services/phoneStore'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    if (!body?.order_id || !body?.pickup_location || !body?.order_items?.length) {
      return NextResponse.json(
        {
          error:
            'Missing required fields. Required: order_id, pickup_location, order_items (non-empty).',
        },
        { status: 400 },
      )
    }

    // Extract session for audit attribution
    let auditEmail = 'unknown'
    let auditRole = 'unknown'
    let auditSessionId = ''
    try {
      const { decryptSession } = require('@/src/services/auth')
      const sessionCookie = req.cookies.get('fiberise_session')?.value
      if (sessionCookie) {
        const session = decryptSession(sessionCookie)
        if (session) {
          auditEmail = session.email || 'unknown'
          auditRole = session.role || 'unknown'
          auditSessionId = session.sessionId || ''
        }
      }
    } catch {}

    const isTest = Boolean(body.is_test_order)

    let data;
    if (isTest) {
      // Mock Shiprocket order creation to prevent external charges/fulfillment processes
      const mockId = Math.floor(10000000 + Math.random() * 90000000)
      data = {
        status: 'success',
        order_id: mockId,
        shipment_id: Math.floor(10000000 + Math.random() * 90000000),
        status_code: 1,
        message: 'Mock Shiprocket order created for testing purposes'
      }

      // Save to Firestore test_orders collection
      try {
        const { markOrderAsTest } = require('@/src/services/firestore.service')
        const ipAddress = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || (req as any).ip || '127.0.0.1'
        const userAgent = req.headers.get('user-agent') || 'Unknown'
        const { parseUserAgent } = require('@/src/utils/userAgentParser')
        const parsedUA = parseUserAgent(userAgent)
        const device = parsedUA.device || 'Unknown'

        await markOrderAsTest(String(data.order_id), true, {
          markedBy: auditEmail,
          ip: ipAddress,
          device: device
        })
      } catch (e) {
        console.error('⚠️ Failed to save test order to Firestore:', e)
      }
    } else {
      data = await createShiprocketAdhocOrder(body)
      if (data.status_code === 0) {
        return NextResponse.json(
          { error: data.message || 'Shiprocket order creation failed', details: data },
          { status: 400 }
        )
      }
    }

    // Success! Update the server-side memory cache with the new Shiprocket order
    try {
      const { addOrderToCache } = require('@/src/services/ordersCache')
      
      const srPhone = body.billing_phone || ''
      const isCod = String(body.payment_method || '').toLowerCase().includes('cod')
      
      const formattedCustomOrder = {
        id: data.order_id || Math.floor(1000000 + Math.random() * 9000000),
        is_test_order: isTest,
        name: body.order_id ? (body.order_id.startsWith('#') ? body.order_id : '#' + body.order_id) : `#SR-${data.order_id}`,
        created_at: body.order_date ? new Date(body.order_date).toISOString() : new Date().toISOString(),
        financial_status: isCod ? 'pending' : 'paid',
        payment_method: isCod ? 'cod' : 'prepaid',
        cancelled_at: null,
        fulfillment_status: null,
        total_price: String(body.sub_total || '0'),
        currency: 'INR',
        customer: {
          first_name: body.billing_customer_name || 'Manual Customer',
          last_name: body.billing_last_name || '',
          email: body.billing_email || '',
          phone: srPhone,
        },
        shipping_address: {
          first_name: body.billing_customer_name || 'Manual Customer',
          last_name: body.billing_last_name || '',
          address1: body.billing_address || '',
          address2: body.billing_address_2 || '',
          city: body.billing_city || '',
          province: body.billing_state || '',
          country: body.billing_country || 'India',
          zip: String(body.billing_pincode || ''),
          phone: srPhone,
        },
        line_items: (body.order_items || []).map((p: any) => ({
          id: p.id || Math.floor(Math.random() * 100000),
          title: p.name || 'Custom Product',
          variant_title: null,
          sku: p.sku || '',
          quantity: p.units || 1,
          price: String(p.selling_price || '0'),
          total_discount: '0',
          fulfillment_status: null,
        })),
        fulfillments: [],
        source: 'shiprocket',
      }

      addOrderToCache(formattedCustomOrder)

      // Persist the phone to disk so it survives restarts & Shiprocket API masking
      storePhone(formattedCustomOrder.id, srPhone)
      storePhoneByChannel(body.order_id || '', srPhone)
    } catch (e) {
      console.error('⚠️ Failed to add cloned order to cache:', e)
    }


    // Fire-and-forget audit log for order creation
    try {
      const { logAction } = require('@/src/services/auditLogService')
      logAction({
        userId: auditEmail,
        userEmail: auditEmail,
        userRole: auditRole,
        sessionId: auditSessionId,
        actionType: 'ORDER_CREATE',
        description: `Created/cloned order ${body.order_id} via Shiprocket (₹${body.sub_total || 0})`,
        module: 'orders',
        status: 'success',
        details: {
          orderId: body.order_id,
          shiprocketOrderId: data.order_id,
          customer: body.billing_customer_name || '',
          amount: body.sub_total || 0,
          paymentMethod: body.payment_method || '',
          items: body.order_items?.length || 0,
        },
        req,
      })
    } catch {}

    // Return order data to the client, including the sanitized phone for UI use
    return NextResponse.json({ ...data, billing_phone: body.billing_phone || '' }, { status: 200 })
  } catch (error: any) {
    console.error('Error creating Shiprocket adhoc order:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create Shiprocket adhoc order' },
      { status: 500 },
    )
  }
}
