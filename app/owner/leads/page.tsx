import type { Metadata } from 'next'
import { LeadsScreen } from '@/components/growth/leads-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Leads - Rep+' }

export default async function OwnerLeadsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  return <LeadsScreen ctx={ctx} view={(await searchParams).view} />
}
