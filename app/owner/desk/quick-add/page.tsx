import type { Metadata } from 'next'
import { NewMemberView } from '@/components/members/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Quick add - Rep+' }

export default async function QuickAddPage() {
  const ctx = await requireStaffPage(['OWNER'])
  return <NewMemberView ctx={ctx} base="/owner" compact />
}
