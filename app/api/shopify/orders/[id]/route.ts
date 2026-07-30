export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cancelShiprocketOrder } from '@/src/services/shiprocketClient'
import { getCachedOrderById, removeOrderFromCache, cancelOrderInCache } from '@/src/services/ordersCache'

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_SHOP_DOMAIN
const API_VERSION = process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION || '2024-01'
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Prefer live Shopify; fall back to CRM cache (Shiprocket-only / offline)
    const cached = getCachedOrderById(id)
    if (cached?.source === 'shiprocket') {
      const { lookupNote } = require('@/src/services/orderNotesStore')
      const note = lookupNote(id) || cached.note || null
      return NextResponse.json({ order: { ...cached, note } }, { status: 200 })
    }

    if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
      if (cached) {
        return NextResponse.json({ order: cached }, { status: 200 })
      }
      return NextResponse.json(
        { error: 'Shopify credentials are not configured.' },
        { status: 500 },
      )
    }

    const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders/${id}.json`

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      if (cached) {
        return NextResponse.json({ order: cached }, { status: 200 })
      }
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Shopify API error: ${res.status} ${res.statusText}`, details: text },
        { status: res.status },
      )
    }

    const data = await res.json()
    const { lookupNote } = require('@/src/services/orderNotesStore')
    const crmNote = lookupNote(id)
    const order = {
      ...data.order,
      note: crmNote || data.order?.note || null,
    }
    return NextResponse.json({ order }, { status: 200 })
  } catch (error: any) {
    console.error('Error fetching Shopify order:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch order' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // 1. Identify order source from in-memory cache
    const cachedOrder = getCachedOrderById(id)
    const isShiprocket = cachedOrder?.source === 'shiprocket'

    if (isShiprocket) {
      // Cancel Shiprocket custom order
      try {
        await cancelShiprocketOrder(Number(id))
      } catch (err: any) {
        console.warn('Failed to cancel order directly on Shiprocket:', err)
      }
      
      // Update in memory cache to mark as cancelled
      cancelOrderInCache(id)
      return NextResponse.json({ success: true, message: 'Shiprocket order cancelled successfully' }, { status: 200 })
    }

    // 2. Shopify order cancellation logic
    if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
      return NextResponse.json(
        { error: 'Shopify credentials are not configured.' },
        { status: 500 },
      )
    }

    // Cancel order on Shopify
    const cancelRes = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders/${id}/cancel.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN,
      },
    })

    if (!cancelRes.ok) {
      const text = await cancelRes.text().catch(() => '')
      // 422 means already cancelled
      if (cancelRes.status !== 422) {
        return NextResponse.json(
          { error: `Shopify cancel error: ${cancelRes.status} ${cancelRes.statusText}`, details: text },
          { status: cancelRes.status },
        )
      }
    }

    // Update in-memory cache to reflect the cancelled status instantly
    cancelOrderInCache(id)

    return NextResponse.json({ success: true, message: 'Shopify order cancelled successfully' }, { status: 200 })
  } catch (error: any) {
    console.error('Error cancelling order:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cancel order' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    
    if (body?.is_test_order === undefined) {
      return NextResponse.json({ error: 'Missing is_test_order field in body' }, { status: 400 })
    }

    const isTest = Boolean(body.is_test_order)

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

    // Save to Firestore
    const { markOrderAsTest } = require('@/src/services/firestore.service')
    
    // Extract network info
    const ipAddress = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || (req as any).ip || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || 'Unknown'
    const { parseUserAgent } = require('@/src/utils/userAgentParser')
    const parsedUA = parseUserAgent(userAgent)
    const device = parsedUA.device || 'Unknown'

    await markOrderAsTest(id, isTest, {
      markedBy: auditEmail,
      ip: ipAddress,
      device: device
    })

    // Update in-memory cache directly
    const { toggleTestOrderInCache, getCachedOrderById } = require('@/src/services/ordersCache')
    toggleTestOrderInCache(id, isTest)

    const cachedOrder = getCachedOrderById(id)
    const orderName = cachedOrder?.name || `#${id}`

    // Log to audit logs (fire-and-forget)
    try {
      const { logAction } = require('@/src/services/auditLogService')
      logAction({
        userId: auditEmail,
        userEmail: auditEmail,
        userRole: auditRole,
        sessionId: auditSessionId,
        actionType: isTest ? 'TEST_ORDER_MARK' : 'TEST_ORDER_UNMARK',
        description: isTest 
          ? `Marked order ${orderName} as Test Order` 
          : `Removed Test Order status from ${orderName}`,
        module: 'orders',
        status: 'success',
        details: { orderId: id, orderName, isTest },
        req,
      })
    } catch (e) {
      console.error('Failed to write toggle test order audit log:', e)
    }

    return NextResponse.json({ success: true, is_test_order: isTest }, { status: 200 })
  } catch (error: any) {
    console.error('Error toggling test order:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to toggle test order' },
      { status: 500 },
    )
  }
}

/** Update CRM / Shopify order note */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    if (typeof body.note !== 'string') {
      return NextResponse.json({ error: 'Missing note string in body' }, { status: 400 })
    }

    const note = body.note.trim()
    const cachedOrder = getCachedOrderById(id)
    const isShiprocket = cachedOrder?.source === 'shiprocket'

    const { storeNote } = require('@/src/services/orderNotesStore')
    const { updateOrderNoteInCache } = require('@/src/services/ordersCache')

    storeNote(id, note)
    updateOrderNoteInCache(id, note)

    // Sync to Shopify when this is a Shopify order
    if (!isShiprocket && SHOP_DOMAIN && ADMIN_TOKEN) {
      try {
        const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders/${id}.json`
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_TOKEN,
          },
          body: JSON.stringify({ order: { id: Number(id) || id, note } }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          console.warn(`⚠️ Shopify note sync failed for ${id}:`, res.status, text)
        }
      } catch (e: any) {
        console.warn('⚠️ Shopify note sync error:', e?.message || e)
      }
    }

    return NextResponse.json({ success: true, note: note || null }, { status: 200 })
  } catch (error: any) {
    console.error('Error saving order note:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save note' },
      { status: 500 },
    )
  }
}

