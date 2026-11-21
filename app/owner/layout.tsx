import type { ReactNode } from 'react'
import { ShellFrame } from '@/components/shell/app-shell'
import { staffFrameProps } from '@/components/staff/staff-shell'
import { requireStaffPage } from '@/lib/auth/page'

// Stays mounted while the owner moves between pages: only the page content
// is swapped, so navigation feels instant (see components/shell/app-shell.tsx).
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStaffPage(['OWNER'], { allowSuspended: true })
  return <ShellFrame initial={await staffFrameProps(ctx)}>{children}</ShellFrame>
}
