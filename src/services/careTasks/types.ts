export type CareTaskStatus =
  | 'pending'
  | 'completed'
  | 'unreachable'
  | 'rescheduled'
  | 'escalated'
  | 'not_interested'

export type CareTaskType =
  | 'cod_confirmation'
  | 'introduction'
  | 'review'
  | 'courtesy'
  | 'upsell'
  | string

export type CareTaskPriority = 'high' | 'medium' | 'low'

export interface CareAssignee {
  userId: string
  email: string
  name: string
}

export interface CareTaskNote {
  id: string
  text: string
  authorEmail: string
  authorName: string
  createdAt: string
}

export interface CareLinkedCall {
  callId: string
  startTime?: string
  createdAt?: string
  duration?: number
  answered?: boolean
  inbound?: boolean
  number?: string
  formattedNumber?: string
  source?: string
  sourceDetail?: string
  recType?: string
  hasRecording?: boolean
  userName?: string
  userEmail?: string
  attachedAt: string
}

export interface CareTask {
  id: string
  dedupeKey: string
  orderId: string
  orderName: string
  customerName: string
  phone: string
  paymentMethod: 'cod' | 'prepaid' | 'unknown'
  packKey: string
  packLabel?: string
  taskType: CareTaskType
  taskLabel: string
  scheduleDay: number
  scheduledAt: string
  /** Original order created_at (ISO) */
  orderCreatedAt?: string | null
  priority: CareTaskPriority
  status: CareTaskStatus
  assignedTo: CareAssignee | null
  /** Who the task was escalated to (when status is escalated). */
  escalatedTo?: CareAssignee | null
  outcome?: string
  remarks?: string
  customerResponse?: string
  /** 1–5 star rating (required on complete for Introduction onwards) */
  customerRating?: number
  /** When the executive last marked the customer unreachable */
  lastUnreachableAt?: string | null
  /** When Call After / reschedule was submitted */
  rescheduledAt?: string | null
  notes: CareTaskNote[]
  lastCall?: CareLinkedCall | null
  calls: CareLinkedCall[]
  createdAt: string
  updatedAt?: string
  completedAt?: string | null
  source: 'auto' | 'manual'
  overdueNotifiedAt?: string | null
  companyId?: string
  /** Display tag written on confirm_cod / cancel_cod */
  careOrderTag?: 'care_confirmed' | 'care_cancelled' | 'aisensy_confirmed' | null
}

/** UI / filter buckets for call-type tabs */
export type CareTaskKind =
  | 'cod_confirmation'
  | 'introduction'
  | 'day_3'
  | 'day_5'
  | 'day_15'
  | 'day_23'
  /** @deprecated legacy alias — treated as day_23 */
  | 'day_28'
  | 'day_30'
  | 'day_60'
  | 'day_90'
  | 'upsell'
  | 'other'

export const CARE_TASK_KIND_TABS: Array<{ key: CareTaskKind; label: string }> = [
  { key: 'cod_confirmation', label: 'COD Confirmation' },
  { key: 'introduction', label: 'Intro Call' },
  { key: 'day_3', label: 'Day 3 Call' },
  { key: 'day_5', label: 'Day 5 Call' },
  { key: 'day_15', label: 'Day 15 Call' },
  { key: 'day_23', label: 'Day 23 Call' },
  { key: 'day_30', label: 'Day 30 Call' },
  { key: 'day_60', label: 'Day 60 Call' },
  { key: 'day_90', label: 'Day 90 Call' },
  { key: 'upsell', label: 'Upsell Call' },
  { key: 'other', label: 'Other' },
]

/** Transformation upsell moved from D28 → D23; keep legacy tasks readable. */
export function normalizeCareScheduleDay(scheduleDay: number): number {
  return Number(scheduleDay) === 28 ? 23 : Number(scheduleDay)
}

export function normalizeCareTaskLabel(label: string): string {
  return String(label || '').replace(/Day\s*28\b/gi, 'Day 23')
}

/** Resolve API/UI kind aliases (legacy day_28 → day_23). */
export function normalizeCareTaskKindParam(
  kind?: string | null,
): CareTaskKind | 'all' | undefined {
  if (!kind || kind === 'all') return kind === 'all' ? 'all' : undefined
  if (kind === 'day_28') return 'day_23'
  return kind as CareTaskKind
}

export function getCareTaskKind(task: Pick<CareTask, 'taskType' | 'scheduleDay'>): CareTaskKind {
  const day = normalizeCareScheduleDay(Number(task.scheduleDay))
  if (task.taskType === 'cod_confirmation' || day === -1) return 'cod_confirmation'
  if (task.taskType === 'introduction' || day === 0) return 'introduction'
  if (day === 3) return 'day_3'
  if (day === 5) return 'day_5'
  if (day === 15) return 'day_15'
  if (day === 23) return 'day_23'
  if (day === 30) return 'day_30'
  if (day === 60) return 'day_60'
  if (day === 90) return 'day_90'
  // Manual upsell (no fixed day) after day buckets
  if (task.taskType === 'upsell') return 'upsell'
  return 'other'
}

/**
 * Pack upsell days (D5/D23/D60/…) keep day_* kinds for Tasks tabs, but still count as
 * upsell work for Delivered Orders · Upsell tasks and open-upsell summaries.
 */
export function isUpsellCareTask(
  task: Pick<CareTask, 'taskType' | 'scheduleDay' | 'id'>,
): boolean {
  if (task.taskType === 'upsell') return true
  if (getCareTaskKind(task) === 'upsell') return true
  return String(task.id || '').includes('__upsell__')
}

/** Star rating required when completing any task except COD confirmation. */
export function requiresCustomerRating(
  task: Pick<CareTask, 'taskType' | 'scheduleDay'>,
): boolean {
  return getCareTaskKind(task) !== 'cod_confirmation'
}

export const CALL_AFTER_MAX_MS = 3 * 24 * 60 * 60 * 1000
export const UNREACHABLE_RETRY_MS = 60 * 60 * 1000


export interface FollowupStep {
  day: number
  taskType: CareTaskType
  taskLabel: string
  priority?: CareTaskPriority
}

export interface FollowupPlan {
  packKey: string
  label: string
  steps: FollowupStep[]
}

export interface PackMatcher {
  packKey: string
  /** Substrings matched against title/sku (case-insensitive) */
  matchers: string[]
  label: string
}

export interface CareOrderGroup {
  key: string
  orderId: string
  orderName: string
  customerName: string
  phone: string
  packKey: string
  packLabel?: string
  orderCreatedAt?: string | null
  paymentMethod: CareTask['paymentMethod']
  assignedTo: CareTask['assignedTo']
  tasks: CareTask[]
  focusTaskId: string
}

export interface CareTaskSummary {
  total: number
  pending: number
  completed: number
  overdue: number
  today: number
  upcoming: number
  missed: number
  escalated: number
  rescheduled: number
  unreachable: number
  notInterested: number
}

export interface ExecutivePerformance {
  email: string
  name: string
  assigned: number
  completed: number
  pending: number
  overdue: number
  callsMade: number
  avgCompletionHours: number | null
  completionPct: number
  lastActivity: string | null
}
