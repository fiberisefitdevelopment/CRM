'use client'

import type { CareOrderAssignmentEntry } from '@/src/services/careAssignmentStore'
import { careExecutiveDisplayName } from '@/src/services/careTasks/executiveConfig'

/** Tiny list-row badge showing which care executive owns the order. */
export function CareExecutiveBadge({
  assignment,
}: {
  assignment?: CareOrderAssignmentEntry | null
}) {
  if (!assignment?.email) return null
  const label = careExecutiveDisplayName(assignment.email, assignment.name || assignment.label)
  return (
    <span
      className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30"
      title={`Assigned to ${assignment.name || label} (${assignment.email})`}
      aria-label={`Care executive: ${assignment.name || label}`}
    >
      Care: {label}
    </span>
  )
}
