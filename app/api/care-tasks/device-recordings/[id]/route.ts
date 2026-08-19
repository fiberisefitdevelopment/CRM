export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import {
  assertCanAccessDeviceRecordings,
  downloadDeviceRecording,
  getDeviceRecordingById,
  getDeviceRecordingSignedUrl,
  recordingFileExtension,
} from '@/src/services/careTasks/deviceRecordings'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'

/**
 * GET /api/care-tasks/device-recordings/:id
 *
 * Query:
 *  - mode=proxy    → stream audio bytes (default)
 *  - mode=url      → JSON { url } signed Storage URL
 *  - mode=redirect → 302 to signed URL
 *  - download=1    → Content-Disposition: attachment
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const recording = await getDeviceRecordingById(id)
    if (!recording) {
      return NextResponse.json({ error: 'Recording not available.' }, { status: 404 })
    }

    await assertCanAccessDeviceRecordings(session, {
      phone: recording.phone,
      orderId: recording.orderId,
    })

    const mode = request.nextUrl.searchParams.get('mode') || 'proxy'
    const asDownload = request.nextUrl.searchParams.get('download') === '1'

    if (mode === 'url' || mode === 'redirect') {
      const location = await getDeviceRecordingSignedUrl(recording)
      if (!location) {
        return NextResponse.json({ error: 'Recording not available.' }, { status: 404 })
      }
      if (mode === 'url') return NextResponse.json({ url: location })
      return NextResponse.redirect(location, 302)
    }

    const { body, contentType, fileName } = await downloadDeviceRecording(recording)
    const ext = recordingFileExtension(recording.firebaseStoragePath, contentType)
    const disposition = asDownload
      ? `attachment; filename="${fileName}"`
      : `inline; filename="recording-${recording.callLogId}.${ext}"`

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Accept-Ranges': 'bytes',
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=120',
      },
    })
  } catch (error: any) {
    const status = error?.status || 500
    console.error('Device recording GET failed:', error)
    return NextResponse.json(
      { error: error?.message || 'Recording not available.' },
      { status: status >= 400 ? status : 500 },
    )
  }
}
