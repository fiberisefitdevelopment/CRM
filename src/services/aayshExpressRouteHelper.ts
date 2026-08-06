import { NextRequest, NextResponse } from 'next/server'

export async function withAayshAuth(
  req: NextRequest,
  handler: () => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const { optionalAuth } = require('@/src/services/auth')
    const session = await optionalAuth(req)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await handler()

    if (result instanceof ArrayBuffer) {
      return new NextResponse(result, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="document.pdf"',
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
