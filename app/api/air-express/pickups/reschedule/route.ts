import { NextRequest } from 'next/server'
import { rescheduleAayshPickup } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.shipmentId || !body?.pickupDate || !body?.pickupTime || !body?.pickupLocation) {
      throw new Error('shipmentId, pickupDate, pickupTime, and pickupLocation are required')
    }
    return rescheduleAayshPickup(body)
  })
}
