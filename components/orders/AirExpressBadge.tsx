'use client'

import { airExpressOrderId, orderTrailUsesAirExpress } from '@/src/utils/airExpressOrder'

/** Compact tag for orders fulfilled via Aaysh Air Express. */
export function AirExpressBadge({
  order,
  live,
  relatedClones,
}: {
  order?: any
  live?: any
  relatedClones?: any[]
}) {
  if (!orderTrailUsesAirExpress(order, live, relatedClones)) return null

  const ids = [
    airExpressOrderId(live),
    airExpressOrderId(order),
    ...(relatedClones || []).map(airExpressOrderId),
  ].filter(Boolean) as string[]
  const uniqueIds = [...new Set(ids)]
  const title =
    uniqueIds.length > 0
      ? `Shipped via Air Express · AE #${uniqueIds[0]}`
      : 'Shipped via Air Express (Aaysh)'

  return (
    <span
      className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30"
      title={title}
      aria-label={title}
    >
      Air Express
    </span>
  )
}
