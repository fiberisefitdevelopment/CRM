import { NextRequest } from 'next/server'
import { listAayshCouriers } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function GET(req: NextRequest) {
  return withAayshAuth(req, async () => listAayshCouriers())
}
