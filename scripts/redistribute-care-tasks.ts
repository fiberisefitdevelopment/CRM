/**
 * Split open care tasks evenly across Shubham and Kawalnain.
 * Usage: npx tsx scripts/redistribute-care-tasks.ts
 */
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import { redistributeOpenTasksAmongExecutives } from '../src/services/careTasks/assignmentEngine'

async function main() {
  const updated = await redistributeOpenTasksAmongExecutives({ forceEven: true })
  console.log(`✅ Split ${updated} open care tasks 50/50 across Shubham and Kawalnain`)
}

main().catch((err) => {
  console.error('❌ Redistribution failed:', err)
  process.exit(1)
})
