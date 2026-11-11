import type { Metadata } from 'next'
import { ComplaintsScreen } from '@/components/growth/complaints-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Complaints - Rep+' }

export default async function OwnerComplaintsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  return <ComplaintsScreen ctx={ctx} filter={(await searchParams).filter} />
}
