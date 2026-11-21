import type { ReactNode } from 'react'
import { AppShell, type FrameProps } from '@/components/shell/app-shell'
import { subscriptionBanner, trainerNav } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { openQueryCount } from '@/lib/queries/service'

// Frame for every trainer desk page (works on a phone on the gym floor).
export async function TrainerShell({ gym, user, title, children }: { gym: { id: string; name: string; athleteLabelPlural: string; subscriptionStatus: string }; user: { id: string; name: string; kind: string }; title: string; children: ReactNode }) {
  const queries = await openQueryCount(tenantDb(gym.id), { id: user.id, kind: 'TRAINER' })
  return (
    <AppShell
      workspace="TRAINER DESK"
      kicker={gym.name}
      title={title}
      sections={trainerNav(gym.athleteLabelPlural, queries)}
      profile={{ name: user.name, subtitle: user.kind === 'OWNER' ? 'Owner (training)' : 'Trainer' }}
      logout="staff"
      banner={subscriptionBanner(gym.subscriptionStatus as Parameters<typeof subscriptionBanner>[0])}
    >
      {children}
    </AppShell>
  )
}

export async function trainerFrameProps(gym: { id: string; name: string; athleteLabelPlural: string }, user: { id: string; name: string; kind: string }): Promise<FrameProps> {
  const queries = await openQueryCount(tenantDb(gym.id), { id: user.id, kind: 'TRAINER' })
  return {
    workspace: 'TRAINER DESK',
    kicker: gym.name,
    title: 'Today',
    sections: trainerNav(gym.athleteLabelPlural, queries),
    profile: { name: user.name, subtitle: user.kind === 'OWNER' ? 'Owner (training)' : 'Trainer' },
    logout: 'staff',
  }
}
