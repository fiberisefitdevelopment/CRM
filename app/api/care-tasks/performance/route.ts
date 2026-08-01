export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getExecutivePerformance } from '@/src/services/careTasks/queries'
import { canViewAllCareTasks, requireSession } from '@/src/services/careTasks/session'

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canViewAllCareTasks(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rows = await getExecutivePerformance()
    return NextResponse.json({ executives: rows })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json({ error: error.message || 'Failed to load performance' }, { status })
  }
}
