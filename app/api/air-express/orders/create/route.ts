import { NextRequest } from 'next/server'
import { createAayshOrder } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.order_id || !body?.pickup_location || !body?.order_items?.length) {
      throw new Error('Missing required fields: order_id, pickup_location, order_items')
    }
    return createAayshOrder(body)
  })
}
