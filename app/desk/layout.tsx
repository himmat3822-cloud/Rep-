import type { ReactNode } from 'react'
import { ShellFrame } from '@/components/shell/app-shell'
import { staffFrameProps } from '@/components/staff/staff-shell'
import { requireStaffPage } from '@/lib/auth/page'

// Persistent frame for the front desk pages (see app/owner/layout.tsx).
export default async function DeskLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  return <ShellFrame initial={await staffFrameProps(ctx)}>{children}</ShellFrame>
}
