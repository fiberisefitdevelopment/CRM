import { NextRequest } from 'next/server'
import { updateAayshPickupLocation } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.order_id?.length || !body?.pickup_location) {
      throw new Error('order_id (array) and pickup_location are required')
    }
    return updateAayshPickupLocation(body)
  })
}
