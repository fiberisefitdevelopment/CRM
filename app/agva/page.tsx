import { redirect } from 'next/navigation'
import { AGVA_HEALTH_HOME } from '@/src/utils/accessControl'

export default function AgvaIndexPage() {
  redirect(AGVA_HEALTH_HOME)
}
