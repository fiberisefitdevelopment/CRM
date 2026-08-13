export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listShopifyCatalogVariants } from '@/src/services/shopifyCareOrders'
import { canAccessCareTasksApi, requireSession } from '@/src/services/careTasks/session'

/** Product/variant catalog for care Create Order picker. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req)
    if (!canAccessCareTasksApi(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const variants = await listShopifyCatalogVariants()
    const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase()
    const filtered = q
      ? variants.filter(
          (v) =>
            v.productTitle.toLowerCase().includes(q) ||
            v.title.toLowerCase().includes(q) ||
            v.sku.toLowerCase().includes(q),
        )
      : variants

    return NextResponse.json({
      variants: filtered.slice(0, 200),
      total: filtered.length,
    })
  } catch (error: any) {
    const status = error?.status || 500
    return NextResponse.json(
      { error: error.message || 'Failed to load products' },
      { status },
    )
  }
}
