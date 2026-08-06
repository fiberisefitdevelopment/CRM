import { NextRequest } from 'next/server'
import { cancelAayshOrders } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    const orderIds: string[] = body?.order_id || body?.orderIds || []
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new Error('order_id must be a non-empty array')
    }
    return cancelAayshOrders(orderIds)
  })
}
