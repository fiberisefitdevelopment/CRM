/**
 * Assign remaining unassigned open care tasks across Shubham and Kawalnain.
 * Does not move customers who already have an executive.
 *
 * Usage: npx tsx scripts/redistribute-care-tasks.ts
 */
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import { redistributeOpenTasksAmongExecutives } from '../src/services/careTasks/assignmentEngine'

async function main() {
  const updated = await redistributeOpenTasksAmongExecutives()
  console.log(`✅ Assigned ${updated} previously unassigned open care task(s)`)
}

main().catch((err) => {
  console.error('❌ Redistribution failed:', err)
  process.exit(1)
})
