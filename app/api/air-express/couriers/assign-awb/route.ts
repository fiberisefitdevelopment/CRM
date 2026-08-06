import { NextRequest } from 'next/server'
import { assignAayshAwb } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.serviceType || !body?.shipments?.length || !body?.pickupDate || !body?.pickupTime || !body?.pickupLocation) {
      throw new Error('serviceType, shipments, pickupDate, pickupTime, and pickupLocation are required')
    }
    return assignAayshAwb(body)
  })
}
