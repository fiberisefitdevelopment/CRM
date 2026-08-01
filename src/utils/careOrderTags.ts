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
