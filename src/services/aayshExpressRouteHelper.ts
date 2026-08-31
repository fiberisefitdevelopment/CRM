import { NextRequest, NextResponse } from 'next/server'

function isPdfBody(result: unknown): result is ArrayBuffer | Uint8Array | Buffer {
  if (result instanceof ArrayBuffer) return true
  if (result instanceof Uint8Array) return true
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(result)) return true
  return false
}

export async function withAayshAuth(
  req: NextRequest,
  handler: () => Promise<unknown>,
  options?: { pdfFilename?: string },
): Promise<NextResponse> {
  try {
    const { optionalAuth } = require('@/src/services/auth')
    const session = await optionalAuth(req)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await handler()

    if (result instanceof NextResponse) return result

    if (isPdfBody(result)) {
      const body = result instanceof ArrayBuffer ? result : new Uint8Array(result)
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${options?.pdfFilename || 'air-express-document.pdf'}"`,
        },
      })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Air Express request failed'
    console.error('Air Express API error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
