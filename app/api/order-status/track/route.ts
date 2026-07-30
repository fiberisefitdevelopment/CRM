import { NextRequest, NextResponse } from 'next/server'
import { getShiprocketTrackingByAwb } from '@/src/services/shiprocketClient'

export async function GET(req: NextRequest) {
  try {
    const awb = req.nextUrl.searchParams.get('awb') || ''
    if (!awb.trim()) {
      return NextResponse.json({ error: 'AWB query param is required' }, { status: 400 })
    }

    const data = await getShiprocketTrackingByAwb(awb.trim())
    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    console.error('Order status track error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch tracking data' },
      { status: 500 },
    )
  }
}
