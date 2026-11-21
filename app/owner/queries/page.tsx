import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { QueriesScreen } from '@/components/queries/queries-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Member queries - Rep+' }

export default async function OwnerQueriesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  return (
    <StaffShell ctx={ctx} title="Member queries">
      <QueriesScreen gymId={ctx.gym.id} viewer={{ id: ctx.user.id, kind: ctx.user.kind }} base="/owner/queries" filter={(await searchParams).filter} memberHref={(id) => `/owner/members/${id}`} />
    </StaffShell>
  )
}
