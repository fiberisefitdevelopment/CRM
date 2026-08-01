import { NextRequest, NextResponse } from 'next/server'
import { runCareTaskScheduler } from '@/src/services/careTasks/scheduler'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: NextRequest) {
  try {
    const result = await runCareTaskScheduler()
    return NextResponse.json({ success: true, result }, { status: 200 })
  } catch (error: any) {
    console.error('❌ Care Tasks Cron Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Care tasks cron failed' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
