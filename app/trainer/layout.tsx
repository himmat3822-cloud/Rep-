import type { ReactNode } from 'react'
import { ShellFrame } from '@/components/shell/app-shell'
import { trainerFrameProps } from '@/components/trainer/trainer-shell'
import { requireStaffPage } from '@/lib/auth/page'

// Persistent frame for the trainer pages (see app/owner/layout.tsx).
export default async function TrainerLayout({ children }: { children: ReactNode }) {
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  return <ShellFrame initial={await trainerFrameProps(gym, user)}>{children}</ShellFrame>
}
