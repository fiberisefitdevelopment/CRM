/**
 * Cron — Incremental Shiprocket + Air Express logistics → Firestore
 *
 * GET/POST /api/cron/orders-logistics-sync
 *
 * Feature-flagged by ORDERS_WRITE_TO_FIRESTORE.
 * Does not change dashboard reads (still cache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncLogisticsToFirestore } from '@/src/services/orders/logisticsFirestoreSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  try {
    const lookbackParam = req.nextUrl.searchParams.get('lookbackDays')
    const lookbackDays = lookbackParam ? Math.max(1, parseInt(lookbackParam, 10) || 14) : 14

    const result = await syncLogisticsToFirestore({ lookbackDays })
    return NextResponse.json({ success: true, result }, { status: 200 })
  } catch (error: any) {
    console.error('❌ Orders logistics sync cron error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Logistics sync failed' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
