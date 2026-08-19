export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  assertCanAccessDeviceRecordings,
  listDeviceRecordingsByPhone,
} from '@/src/services/careTasks/deviceRecordings'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const phone = req.nextUrl.searchParams.get('phone') || ''
    const orderId = req.nextUrl.searchParams.get('orderId') || ''
    if (!phone && !orderId) {
      return NextResponse.json({ error: 'phone is required.' }, { status: 400 })
    }

    await assertCanAccessDeviceRecordings(session, { phone, orderId })
    const recordings = phone
      ? await listDeviceRecordingsByPhone(phone, { orderId })
      : []

    return NextResponse.json({ recordings })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to load call recordings' },
      { status },
    )
  }
}
