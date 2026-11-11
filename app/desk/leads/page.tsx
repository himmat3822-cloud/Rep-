import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LeadsScreen } from '@/components/growth/leads-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Leads - Rep+' }

// Front desk: add walk-ins and do today's follow-up calls.
export default async function DeskLeadsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  if (ctx.user.kind === 'OWNER') redirect('/owner/leads')
  return <LeadsScreen ctx={ctx} view={(await searchParams).view} />
}
