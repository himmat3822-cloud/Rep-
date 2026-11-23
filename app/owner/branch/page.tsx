import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { StaffShell } from '@/components/staff/staff-shell'
import { BranchViewPanel } from '@/components/owner/branch-view-panel'
import { requireStaffPage } from '@/lib/auth/page'
import { getBranchView } from '@/lib/owner/branch-view'

export const metadata: Metadata = { title: 'Branch view - Rep+' }

export default async function OwnerBranchPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const view = await getBranchView(ctx.gym.id, true)
  // Single-branch gyms (or plans without multi-branch) have nothing to pick.
  if (!view.multi) redirect('/owner')
  return (
    <StaffShell ctx={ctx} title="Branch view">
      <BranchViewPanel gymId={ctx.gym.id} sessionMinutes={ctx.gym.sessionMinutes} view={view} />
    </StaffShell>
  )
}
