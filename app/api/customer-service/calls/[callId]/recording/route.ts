import { NextRequest, NextResponse } from 'next/server'
import {
  CustomerServiceApiError,
  getRecording,
  getRecordingUrl,
} from '@/src/services/customerService'

function audioContentType(contentType: string, location?: string): string {
  const lower = `${contentType} ${location || ''}`.toLowerCase()
  if (lower.includes('audio/')) {
    // Prefer concrete audio types over octet-stream
    if (contentType.toLowerCase().startsWith('audio/')) return contentType
  }
  if (lower.includes('.m4a') || lower.includes('mp4') || lower.includes('m4a')) return 'audio/mp4'
  if (lower.includes('.mp3') || lower.includes('mpeg')) return 'audio/mpeg'
  if (lower.includes('.wav')) return 'audio/wav'
  if (lower.includes('.ogg')) return 'audio/ogg'
  if (lower.includes('.webm')) return 'audio/webm'
  return 'audio/mp4'
}

/**
 * GET /api/customer-service/calls/:callId/recording
 *
 * Query:
 *  - mode=proxy    → stream audio bytes (default, best for <audio> + download)
 *  - mode=redirect → 302 to temporary Azure blob URL
 *  - mode=url      → JSON { url }
 *  - download=1    → Content-Disposition: attachment
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const { callId } = await context.params
    if (!callId) {
      return NextResponse.json({ error: 'callId is required.' }, { status: 400 })
    }

    const mode = request.nextUrl.searchParams.get('mode') || 'proxy'
    const asDownload = request.nextUrl.searchParams.get('download') === '1'

    if (mode === 'url' || mode === 'redirect') {
      const location = await getRecordingUrl(callId)
      if (!location) {
        return NextResponse.json({ error: 'Recording not available.' }, { status: 404 })
      }
      if (mode === 'url') {
        return NextResponse.json({ url: location })
      }
      return NextResponse.redirect(location, 302)
    }

    const { body, contentType, location } = await getRecording(callId)
    const buffer = Buffer.from(body)
    const type = audioContentType(contentType, location)
    const ext = type.includes('mp4') || type.includes('m4a')
      ? 'm4a'
      : type.includes('wav')
        ? 'wav'
        : 'mp3'
    const disposition = asDownload
      ? `attachment; filename="recording-${callId}.${ext}"`
      : `inline; filename="recording-${callId}.${ext}"`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=120',
      },
    })
  } catch (error: any) {
    const status = error instanceof CustomerServiceApiError ? error.status : 500
    console.error('Customer Service recording GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Recording not available.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
