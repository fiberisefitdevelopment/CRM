import { NextRequest } from 'next/server'
import { updateAayshOrder } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    if (!body?.order_id) throw new Error('order_id is required')
    return updateAayshOrder(body)
  })
}
