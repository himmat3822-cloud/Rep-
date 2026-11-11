import type { Metadata } from 'next'
import { NewMemberView } from '@/components/members/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Add member - Rep+' }

export default async function NewMemberPage() {
  const ctx = await requireStaffPage(['OWNER'])
  return <NewMemberView ctx={ctx} base="/owner" compact={false} />
}
