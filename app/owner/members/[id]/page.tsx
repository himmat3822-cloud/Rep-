import type { Metadata } from 'next'
import { MemberProfileView } from '@/components/members/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Member - Rep+' }

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sell?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const { id } = await params
  const { sell } = await searchParams
  return <MemberProfileView ctx={ctx} base="/owner" id={id} openSell={sell === '1'} />
}
