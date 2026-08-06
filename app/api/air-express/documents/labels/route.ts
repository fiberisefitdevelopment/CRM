import { NextRequest } from 'next/server'
import { generateAayshPdf } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

async function handlePdf(req: NextRequest, type: 'labels' | 'manifests' | 'invoices') {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    const shipmentIds: string[] = body?.shipmentIds || []
    if (!Array.isArray(shipmentIds) || shipmentIds.length === 0) {
      throw new Error('shipmentIds must be a non-empty array')
    }
    return generateAayshPdf(type, shipmentIds)
  })
}

export async function POST(req: NextRequest) {
  return handlePdf(req, 'labels')
}
