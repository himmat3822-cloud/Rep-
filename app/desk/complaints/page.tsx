import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ComplaintsScreen } from '@/components/growth/complaints-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Complaints - Rep+' }

export default async function DeskComplaintsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  if (ctx.user.kind === 'OWNER') redirect('/owner/complaints')
  return <ComplaintsScreen ctx={ctx} filter={(await searchParams).filter} />
}
