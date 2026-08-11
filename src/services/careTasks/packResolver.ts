import type { FollowupPlan, PackMatcher } from './types'
import {
  DEFAULT_FOLLOWUP_PLANS,
  DEFAULT_PACK_MATCHERS,
  type CareTaskConfig,
} from './followupPlans'

export interface ResolvedPack {
  packKey: string
  label: string
  plan: FollowupPlan
}

function lineItemBlob(li: any): string {
  return `${li?.title || ''} ${li?.name || ''} ${li?.sku || ''}`.toLowerCase()
}

function lineBlob(order: any): string {
  const items = Array.isArray(order?.line_items) ? order.line_items : []
  return items.map(lineItemBlob).join(' ')
}

export function resolvePackFromLineItem(
  lineItem: any,
  config?: Pick<CareTaskConfig, 'packMatchers' | 'plans' | 'defaultPackKey'>,
): ResolvedPack | null {
  const matchers: PackMatcher[] = config?.packMatchers || DEFAULT_PACK_MATCHERS
  const plans = config?.plans || DEFAULT_FOLLOWUP_PLANS
  const blob = lineItemBlob(lineItem)

  for (const m of matchers) {
    if (m.matchers.some((needle) => needle && blob.includes(String(needle).toLowerCase()))) {
      const plan = plans[m.packKey] || DEFAULT_FOLLOWUP_PLANS[m.packKey]
      if (plan) {
        return { packKey: m.packKey, label: m.label || plan.label, plan }
      }
      return {
        packKey: m.packKey,
        label: m.label,
        plan: {
          packKey: m.packKey,
          label: m.label,
          steps: [{ day: 0, taskType: 'introduction', taskLabel: 'Introduction Call', priority: 'high' }],
        },
      }
    }
  }

  return null
}

export function resolvePackFromOrder(
  order: any,
  config?: Pick<CareTaskConfig, 'packMatchers' | 'plans' | 'defaultPackKey'>,
): ResolvedPack {
  const matchers: PackMatcher[] = config?.packMatchers || DEFAULT_PACK_MATCHERS
  const plans = config?.plans || DEFAULT_FOLLOWUP_PLANS
  const defaultKey = config?.defaultPackKey || '7'
  const blob = lineBlob(order)

  for (const m of matchers) {
    if (m.matchers.some((needle) => needle && blob.includes(String(needle).toLowerCase()))) {
      const plan = plans[m.packKey] || DEFAULT_FOLLOWUP_PLANS[m.packKey]
      if (plan) {
        return { packKey: m.packKey, label: m.label || plan.label, plan }
      }
      return {
        packKey: m.packKey,
        label: m.label,
        plan: {
          packKey: m.packKey,
          label: m.label,
          steps: [{ day: 0, taskType: 'introduction', taskLabel: 'Introduction Call', priority: 'high' }],
        },
      }
    }
  }

  const fallback = plans[defaultKey] || DEFAULT_FOLLOWUP_PLANS[defaultKey] || DEFAULT_FOLLOWUP_PLANS['7']
  return {
    packKey: fallback.packKey,
    label: fallback.label,
    plan: fallback,
  }
}
