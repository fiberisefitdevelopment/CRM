export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCareTaskConfig } from '@/src/services/careTasks/followupPlans'
import { buildSalesAnalytics } from '@/src/services/salesAnalytics'
import { loadOrdersForAnalytics } from '@/src/services/analyticsOrders'
import { buildGenderAnalyticsFromOrders } from '@/src/services/genderFromOrders'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const includeTest = searchParams.get('include_test') === 'true'
    const refresh = searchParams.get('refresh') === 'true'
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const datePreset = searchParams.get('date_preset')

    const { orders: rawOrders, cacheEmpty } = await loadOrdersForAnalytics({
      startDate,
      endDate,
      datePreset,
      includeTest,
      refresh,
    })

    if (cacheEmpty) {
      return NextResponse.json({
        syncing: true,
        isOffline: false,
        dateRange: {
          startDate: startDate || null,
          endDate: endDate || null,
          preset: datePreset || null,
        },
      })
    }

    const orders = rawOrders
    const config = await getCareTaskConfig()
    const analytics = buildSalesAnalytics(orders, config)
    let gender: ReturnType<typeof buildGenderAnalyticsFromOrders> | null = null
    try {
      gender = buildGenderAnalyticsFromOrders(orders)
    } catch (err) {
      console.warn('analytics: gender breakdown skipped', err)
    }

    return NextResponse.json({
      ...analytics,
      gender: gender
        ? {
            summary: gender.summary,
            topProductsByGender: gender.topProductsByGender,
            totalOrders: gender.totalOrders,
          }
        : null,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
        preset: datePreset || null,
      },
      isOffline: false,
      syncing: false,
    })
  } catch (err: any) {
    console.error('Product sales error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
