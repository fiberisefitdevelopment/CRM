import { NextRequest } from 'next/server'
import { getAayshOrder } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params
  return withAayshAuth(req, async () => getAayshOrder(orderId))
}
