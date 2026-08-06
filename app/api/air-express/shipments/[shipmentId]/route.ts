import { NextRequest } from 'next/server'
import { getAayshShipment } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> },
) {
  const { shipmentId } = await params
  return withAayshAuth(req, async () => getAayshShipment(shipmentId))
}
