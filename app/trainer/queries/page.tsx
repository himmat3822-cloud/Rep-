import type { Metadata } from 'next'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { QueriesScreen } from '@/components/queries/queries-screen'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Member queries - Rep+' }

export default async function TrainerQueriesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  return (
    <TrainerShell gym={gym} user={user} title="Member queries">
      <QueriesScreen gymId={gym.id} viewer={{ id: user.id, kind: user.kind === 'OWNER' ? 'TRAINER' : user.kind }} base="/trainer/queries" filter={(await searchParams).filter} memberHref={(id) => `/trainer/athletes/${id}`} />
    </TrainerShell>
  )
}
