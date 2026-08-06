import { NextRequest } from 'next/server'
import { cancelAayshPickup } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.shipmentId) throw new Error('shipmentId is required')
    return cancelAayshPickup(body.shipmentId)
  })
}
