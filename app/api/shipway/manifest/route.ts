export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createShipwayManifest } from '@/src/services/shipwayClient'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orderIds = Array.isArray(body.orderIds)
      ? body.orderIds
      : body.orderId
        ? [body.orderId]
        : []

    if (!orderIds.length) {
      return NextResponse.json({ error: 'orderIds array is required' }, { status: 400 })
    }

    const data = await createShipwayManifest(orderIds.map((id: any) => String(id).replace(/^#/, '')))
    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    console.error('Shipway manifest error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to create Shipway manifest' },
      { status: 500 },
    )
  }
}
