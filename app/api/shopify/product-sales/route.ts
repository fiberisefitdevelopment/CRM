export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCareTaskConfig } from '@/src/services/careTasks/followupPlans'
import { buildSalesAnalytics } from '@/src/services/salesAnalytics'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const includeTest = searchParams.get('include_test') === 'true'

    const forwardParams = new URLSearchParams({ all: 'true' })
    for (const key of ['start_date', 'end_date', 'date_preset', 'refresh']) {
      const val = searchParams.get(key)
      if (val) forwardParams.set(key, val)
    }

    const baseUrl = req.nextUrl.origin
    const authHeader = req.headers.get('authorization') || ''

    const ordersRes = await fetch(`${baseUrl}/api/shopify/orders?${forwardParams}`, {
      headers: { authorization: authHeader },
    })

    if (!ordersRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 502 })
    }

    const data = await ordersRes.json()

    if (data.syncing && (!data.orders || data.orders.length === 0)) {
      return NextResponse.json({
        syncing: true,
        isOffline: data.isOffline || false,
        dateRange: {
          startDate: searchParams.get('start_date') || null,
          endDate: searchParams.get('end_date') || null,
          preset: searchParams.get('date_preset') || null,
        },
      })
    }

    let orders: any[] = data.orders || []
    if (!includeTest) {
      orders = orders.filter((o) => !o.is_test_order)
    }

    const config = await getCareTaskConfig()
    const analytics = buildSalesAnalytics(orders, config)

    const genderRes = await fetch(
      `${baseUrl}/api/shopify/gender-analytics${searchParams.get('refresh') === 'true' ? '?refresh=true' : ''}`,
      { headers: { authorization: authHeader } },
    )
    const gender = genderRes.ok ? await genderRes.json() : null

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
        startDate: searchParams.get('start_date') || null,
        endDate: searchParams.get('end_date') || null,
        preset: searchParams.get('date_preset') || null,
      },
      isOffline: data.isOffline || false,
      syncing: false,
    })
  } catch (err: any) {
    console.error('Product sales error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
