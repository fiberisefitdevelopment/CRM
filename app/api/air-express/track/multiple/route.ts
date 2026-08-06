import { NextRequest } from 'next/server'
import { trackAayshMultipleAwbs } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const body = await req.json().catch(() => null)
    const awbs: string[] = body?.awbs || []
    if (!Array.isArray(awbs) || awbs.length === 0) {
      throw new Error('awbs must be a non-empty array')
    }
    return trackAayshMultipleAwbs(awbs)
  })
}
