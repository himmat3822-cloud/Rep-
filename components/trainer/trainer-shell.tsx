import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { subscriptionBanner, trainerNav } from '@/lib/nav'

// Frame for every trainer desk page (works on a phone on the gym floor).
export function TrainerShell({ gym, user, title, children }: { gym: { name: string; athleteLabelPlural: string; subscriptionStatus: string }; user: { name: string; kind: string }; title: string; children: ReactNode }) {
  return (
    <AppShell
      workspace="TRAINER DESK"
      kicker={gym.name}
      title={title}
      sections={trainerNav(gym.athleteLabelPlural)}
      profile={{ name: user.name, subtitle: user.kind === 'OWNER' ? 'Owner (training)' : 'Trainer' }}
      logout="staff"
      banner={subscriptionBanner(gym.subscriptionStatus as Parameters<typeof subscriptionBanner>[0])}
    >
      {children}
    </AppShell>
  )
}
