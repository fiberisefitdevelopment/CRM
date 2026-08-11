export type CareOrderTagKind = 'care_confirmed' | 'care_cancelled' | 'aisensy_confirmed'

export interface CareOrderTagEntry {
  kind: CareOrderTagKind
  label: string
  orderId: string
  orderName?: string | null
  byEmail?: string | null
  byName?: string | null
  updatedAt: string
}

export function careOrderTagLabel(kind: CareOrderTagKind): string {
  switch (kind) {
    case 'care_confirmed':
      return 'Care confirmed'
    case 'care_cancelled':
      return 'Care cancelled'
    case 'aisensy_confirmed':
      return 'AiSensy confirmed'
    default:
      return 'Care tag'
  }
}

export function careOrderTagTone(kind: CareOrderTagKind): 'emerald' | 'amber' | 'purple' {
  switch (kind) {
    case 'care_confirmed':
      return 'emerald'
    case 'care_cancelled':
      return 'amber'
    case 'aisensy_confirmed':
      return 'purple'
    default:
      return 'emerald'
  }
}

/** True when a care task reflects a confirmed COD order (care or AiSensy). */
export function isCareTaskCodConfirmed(task: {
  careOrderTag?: CareOrderTagKind | string | null
  outcome?: string | null
  remarks?: string | null
}): boolean {
  const raw = String(task.careOrderTag || '').trim()
  if (raw === 'care_confirmed' || raw === 'aisensy_confirmed') return true
  const outcome = String(task.outcome || '').toLowerCase()
  if (outcome.includes('cod confirmed') || /^confirmed by /.test(outcome)) return true
  const remarks = String(task.remarks || '').toLowerCase()
  if (remarks.includes('order confirmed')) return true
  return false
}

/** True if Customer Care or AiSensy already confirmed the COD order. */
export function hasCodConfirmation(order: {
  tags?: string | null
  care_tag?: CareOrderTagEntry | null
}): boolean {
  const kind = order?.care_tag?.kind
  if (kind === 'care_confirmed' || kind === 'aisensy_confirmed') return true

  const tags = String(order?.tags || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
  if (!tags.trim()) return false

  // Shopify / AiSensy tags e.g. "ai sensy cod confirmed", "aisensy_cod_confirmed"
  if (tags.includes('ai sensy cod confirmed') || tags.includes('aisensy cod confirmed')) return true
  if (tags.includes('aisensy') && tags.includes('confirm')) return true
  if (tags.includes('cod confirmed') && (tags.includes('aisensy') || tags.includes('ai sensy'))) {
    return true
  }
  return false
}
