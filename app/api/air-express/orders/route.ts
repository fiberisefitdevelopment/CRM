import { NextRequest } from 'next/server'
import { listAayshOrders } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function GET(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const { searchParams } = new URL(req.url)
    const params: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      params[key] = value
    })
    return listAayshOrders(params)
  })
}
