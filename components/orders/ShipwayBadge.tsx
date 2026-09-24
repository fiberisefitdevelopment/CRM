'use client'

import { orderTrailUsesShipway, shipwayOrderId } from '@/src/utils/shipwayOrder'

/** Compact tag for orders fulfilled via Shipway. */
export function ShipwayBadge({
  order,
  live,
  relatedClones,
}: {
  order?: any
  live?: any
  relatedClones?: any[]
}) {
  if (!orderTrailUsesShipway(order, live, relatedClones)) return null

  const ids = [
    shipwayOrderId(live),
    shipwayOrderId(order),
    ...(relatedClones || []).map(shipwayOrderId),
  ].filter(Boolean) as string[]
  const uniqueIds = [...new Set(ids)]
  const title =
    uniqueIds.length > 0
      ? `Shipped via Shipway · #${uniqueIds[0]}`
      : 'Shipped via Shipway'

  return (
    <span
      className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30"
      title={title}
      aria-label={title}
    >
      Shipway
    </span>
  )
}
