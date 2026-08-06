import { NextRequest } from 'next/server'
import { trackAayshByAwb } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ awb: string }> },
) {
  const { awb } = await params
  return withAayshAuth(req, async () => trackAayshByAwb(awb))
}
