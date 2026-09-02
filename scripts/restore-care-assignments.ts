/**
 * Restore original care-executive ownership after the 50/50 force split,
 * then assign only remaining unassigned open tasks.
 *
 * Usage:
 *   npx tsx scripts/restore-care-assignments.ts --dry-run
 *   npx tsx scripts/restore-care-assignments.ts
 */
import { execSync } from 'child_process'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import {
  redistributeOpenTasksAmongExecutives,
  restoreOriginalCareAssignments,
} from '../src/services/careTasks/assignmentEngine'

const PRE_SPLIT_COMMIT = '8e182f0'
const dryRun = process.argv.includes('--dry-run')

function loadPreSplitSnapshot(): Record<string, any> | undefined {
  try {
    const raw = execSync(`git show ${PRE_SPLIT_COMMIT}:.care-order-assignments.json`, {
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    })
    const parsed = JSON.parse(raw)
    console.log(
      `Loaded pre-split snapshot from ${PRE_SPLIT_COMMIT} (${Object.keys(parsed).length} keys)`,
    )
    return parsed
  } catch (err: any) {
    console.warn(
      `Could not load git snapshot ${PRE_SPLIT_COMMIT}:`,
      err?.message || err,
    )
    return undefined
  }
}

async function main() {
  const orderSnapshot = loadPreSplitSnapshot()
  const restored = await restoreOriginalCareAssignments({
    dryRun,
    orderSnapshot,
  })
  console.log('Restore result:', restored)

  if (dryRun) {
    console.log('Dry run only — no Firestore writes, no unassigned fill.')
    return
  }

  const filled = await redistributeOpenTasksAmongExecutives()
  console.log(`Filled ${filled} previously unassigned open task(s). Original owners were left in place.`)
}

main().catch((err) => {
  console.error('❌ Restore failed:', err)
  process.exit(1)
})
