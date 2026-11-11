import type { Metadata } from 'next'
import { MembersListView } from '@/components/members/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Members - Rep+' }

export default async function MembersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  return <MembersListView ctx={ctx} base="/desk" searchParams={await searchParams} />
}
