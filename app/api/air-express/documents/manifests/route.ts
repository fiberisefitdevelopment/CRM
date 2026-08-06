import { NextRequest } from 'next/server'
import { generateAayshPdf } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    const shipmentIds: string[] = body?.shipmentIds || []
    if (!Array.isArray(shipmentIds) || shipmentIds.length === 0) {
      throw new Error('shipmentIds must be a non-empty array')
    }
    return generateAayshPdf('manifests', shipmentIds)
  })
}
