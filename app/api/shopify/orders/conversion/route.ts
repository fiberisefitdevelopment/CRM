export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { fetchOrderConversions } from '@/src/services/orders/shopifyCustomerJourney'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids) ? body.ids.map((id: unknown) => String(id)) : []
    if (!ids.length) {
      return NextResponse.json({ conversions: {} })
    }
    if (ids.length > 100) {
      return NextResponse.json({ error: 'Send at most 100 order ids.' }, { status: 400 })
    }
    const conversions = await fetchOrderConversions(ids)
    return NextResponse.json({ conversions })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load conversion details'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
