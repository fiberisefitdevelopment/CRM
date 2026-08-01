'use client'

import type { CareOrderTagEntry, CareOrderTagKind } from '@/src/utils/careOrderTags'
import { careOrderTagLabel, careOrderTagTone } from '@/src/utils/careOrderTags'

const TONE_CLASS: Record<string, string> = {
  emerald: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
  purple: 'bg-purple-500/12 text-purple-700 dark:text-purple-300 border-purple-500/30',
}

function hoverText(tag: CareOrderTagEntry | null | undefined, kind: CareOrderTagKind, label: string): string {
  const who =
    [tag?.byName, tag?.byEmail].filter(Boolean).join(' · ') ||
    (kind === 'aisensy_confirmed' ? 'AiSensy' : null)

  if (kind === 'care_confirmed') {
    return who ? `Confirmed by ${who}` : 'Confirmed by customer care'
  }
  if (kind === 'care_cancelled') {
    return who ? `Cancel requested by ${who}` : 'Cancel requested by customer care'
  }
  if (kind === 'aisensy_confirmed') {
    return who ? `Confirmed via ${who}` : 'Confirmed via AiSensy'
  }
  return label
}

/** Tiny list-row tag for care / AiSensy COD confirmation status. */
export function CareOrderTagBadge({
  tag,
  kind,
}: {
  tag?: CareOrderTagEntry | null
  kind?: CareOrderTagKind | null
}) {
  const resolvedKind = tag?.kind || kind
  if (!resolvedKind) return null
  const label = tag?.label || careOrderTagLabel(resolvedKind)
  const tone = careOrderTagTone(resolvedKind)
  return (
    <span
      className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${TONE_CLASS[tone]}`}
      title={hoverText(tag, resolvedKind, label)}
      aria-label={hoverText(tag, resolvedKind, label)}
    >
      {label}
    </span>
  )
}
