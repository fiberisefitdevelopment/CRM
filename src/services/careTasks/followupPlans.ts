import admin from 'firebase-admin'
import { getFirebaseAdmin } from '@/src/firebase/firebase.config'
import type { FollowupPlan, PackMatcher } from './types'

export const DEFAULT_PACK_MATCHERS: PackMatcher[] = [
  { packKey: '90', label: 'Ultimate Pack', matchers: ['ultimate'] },
  { packKey: '30', label: 'Transformation Pack', matchers: ['transformation'] },
  { packKey: '7', label: 'Starter Pack', matchers: ['starter'] },
]

/** Configurable follow-up plans keyed by pack duration days. */
export const DEFAULT_FOLLOWUP_PLANS: Record<string, FollowupPlan> = {
  '7': {
    packKey: '7',
    label: 'Starter Pack',
    steps: [
      { day: 0, taskType: 'introduction', taskLabel: 'Introduction Call', priority: 'high' },
      { day: 3, taskType: 'review', taskLabel: 'Day 3 Review Call', priority: 'medium' },
      { day: 5, taskType: 'upsell', taskLabel: 'Day 5 Upsell Call', priority: 'medium' },
    ],
  },
  '30': {
    packKey: '30',
    label: 'Transformation Pack',
    steps: [
      { day: 0, taskType: 'introduction', taskLabel: 'Introduction Call', priority: 'high' },
      { day: 15, taskType: 'review', taskLabel: 'Day 15 Review Call', priority: 'medium' },
      { day: 23, taskType: 'upsell', taskLabel: 'Day 23 Upsell Call', priority: 'high' },
    ],
  },
  '90': {
    packKey: '90',
    label: 'Ultimate Pack',
    steps: [
      { day: 0, taskType: 'introduction', taskLabel: 'Introduction Call', priority: 'high' },
      { day: 15, taskType: 'review', taskLabel: 'Day 15 Review Call', priority: 'medium' },
      { day: 30, taskType: 'review', taskLabel: 'Day 30 Review Call', priority: 'medium' },
      { day: 60, taskType: 'upsell', taskLabel: 'Day 60 Upsell Call', priority: 'high' },
    ],
  },
}

export interface CareTaskConfig {
  packMatchers: PackMatcher[]
  plans: Record<string, FollowupPlan>
  slaHours: number
  defaultPackKey: string
}

const CONFIG_COL = 'careTaskConfig'
const CONFIG_DOC = 'followup_plans'

function getDb() {
  return admin.firestore(getFirebaseAdmin())
}

export async function getCareTaskConfig(): Promise<CareTaskConfig> {
  try {
    const snap = await getDb().collection(CONFIG_COL).doc(CONFIG_DOC).get()
    if (!snap.exists) {
      return {
        packMatchers: DEFAULT_PACK_MATCHERS,
        plans: DEFAULT_FOLLOWUP_PLANS,
        slaHours: 24,
        defaultPackKey: '7',
      }
    }
    const data = snap.data() || {}
    return {
      packMatchers: Array.isArray(data.packMatchers) ? data.packMatchers : DEFAULT_PACK_MATCHERS,
      // Product schedule is source of truth for Starter / Transformation / Ultimate
      plans: {
        ...(data.plans && typeof data.plans === 'object' ? data.plans : {}),
        ...DEFAULT_FOLLOWUP_PLANS,
      },
      slaHours: typeof data.slaHours === 'number' ? data.slaHours : 24,
      defaultPackKey: data.defaultPackKey || '7',
    }
  } catch (err) {
    console.error('careTasks: failed to load config, using defaults', err)
    return {
      packMatchers: DEFAULT_PACK_MATCHERS,
      plans: DEFAULT_FOLLOWUP_PLANS,
      slaHours: 24,
      defaultPackKey: '7',
    }
  }
}

export async function ensureCareTaskConfigSeeded(): Promise<void> {
  const ref = getDb().collection(CONFIG_COL).doc(CONFIG_DOC)
  const snap = await ref.get()
  if (snap.exists) return
  await ref.set({
    packMatchers: DEFAULT_PACK_MATCHERS,
    plans: DEFAULT_FOLLOWUP_PLANS,
    slaHours: 24,
    defaultPackKey: '7',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}
