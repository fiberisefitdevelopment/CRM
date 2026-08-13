/**
 * Split open care tasks evenly across active executives (Shubham / Kawalnain).
 */
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env') })

import { redistributeOpenTasksAmongExecutives } from '../src/services/careTasks/assignmentEngine'

async function main() {
  const updated = await redistributeOpenTasksAmongExecutives()
  console.log(`✅ Redistributed ${updated} open care tasks across executives`)
}

main().catch((err) => {
  console.error('❌ Redistribution failed:', err)
  process.exit(1)
})
