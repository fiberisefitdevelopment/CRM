export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getShipwayTracking } from '@/src/services/shipwayClient'

export async function GET(req: NextRequest) {
  try {
    const awb = req.nextUrl.searchParams.get('awb') || ''
    if (!awb.trim()) {
      return NextResponse.json({ error: 'AWB query param is required' }, { status: 400 })
    }

    const data = await getShipwayTracking(awb.trim())
    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    console.error('Shipway track error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch Shipway tracking data' },
      { status: 500 },
    )
  }
}
