import { NextRequest } from 'next/server'
import { generateAayshPdfFromBody } from '@/src/services/aayshExpressDocuments'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(
    req,
    async () => {
      const body = await req.json().catch(() => null)
      return generateAayshPdfFromBody('invoices', body)
    },
    { pdfFilename: 'aaysh-invoices.pdf' },
  )
}
