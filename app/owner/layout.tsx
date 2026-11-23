import type { ReactNode } from 'react'
import { ShellFrame } from '@/components/shell/app-shell'
import { staffFrameProps } from '@/components/staff/staff-shell'
import { BranchViewPanel } from '@/components/owner/branch-view-panel'
import { requireStaffPage } from '@/lib/auth/page'
import { getBranchView } from '@/lib/owner/branch-view'

// Stays mounted while the owner moves between pages: only the page content
// is swapped, so navigation feels instant (see components/shell/app-shell.tsx).
// "One branch at a time" owners see the branch picker until they open one.
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStaffPage(['OWNER'], { allowSuspended: true })
  const [frame, view] = await Promise.all([staffFrameProps(ctx), getBranchView(ctx.gym.id, true)])
  if (view.mode === 'separate' && !view.branchId) {
    return (
      <ShellFrame initial={{ ...frame, title: 'Pick a branch' }}>
        <BranchViewPanel gymId={ctx.gym.id} sessionMinutes={ctx.gym.sessionMinutes} view={view} />
      </ShellFrame>
    )
  }
  return <ShellFrame initial={frame}>{children}</ShellFrame>
}
