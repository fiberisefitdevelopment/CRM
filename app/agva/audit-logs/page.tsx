import { AgvaWorkspaceLayout } from '@/components/agva/AgvaWorkspaceLayout'
import { AgvaAuditLogsPanel } from '@/components/agva/AgvaAuditLogsPanel'

export default function AgvaAuditLogsPage() {
  return (
    <AgvaWorkspaceLayout>
      <AgvaAuditLogsPanel />
    </AgvaWorkspaceLayout>
  )
}
