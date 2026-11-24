import type { ReactNode } from 'react'
import { AppShell, type FrameProps } from '@/components/shell/app-shell'
import { ownerTrainingFrame } from '@/components/staff/staff-shell'
import { subscriptionBanner, trainerNav } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { openQueryCount } from '@/lib/queries/service'
import { getOwnerTraining, switchToOwner } from '@/lib/trainer/coaches'

// Frame for every trainer desk page (works on a phone on the gym floor).
// Owners who train: "together" shows the owner menu here as well;
// "separate" shows the trainer menu with a switch back to the owner side.

type Gym = { id: string; name: string; athleteLabelPlural: string }
type User = { id: string; name: string; kind: string }

async function frameFor(gym: Gym, user: User, title: string): Promise<FrameProps> {
  if (user.kind === 'OWNER') {
    const together = await ownerTrainingFrame(gym.id, user)
    if (together) return { ...together, kicker: 'My training', title }
  }
  const [queries, training] = await Promise.all([openQueryCount(tenantDb(gym.id), { id: user.id, kind: 'TRAINER' }), user.kind === 'OWNER' ? getOwnerTraining(gym.id) : null])
  const separate = training === 'separate'
  return {
    workspace: 'TRAINER DESK',
    kicker: gym.name,
    title,
    // The "Owner dashboard" link is replaced by the switch button.
    sections: trainerNav(gym.athleteLabelPlural, queries, user.kind === 'OWNER' && !separate),
    profile: { name: user.name, subtitle: user.kind === 'OWNER' ? 'Owner (training)' : 'Trainer' },
    logout: 'staff',
    switchTo: switchToOwner(training),
  }
}

export async function TrainerShell({ gym, user, title, children }: { gym: Gym & { subscriptionStatus: string }; user: User; title: string; children: ReactNode }) {
  const frame = await frameFor(gym, user, title)
  return (
    <AppShell {...frame} banner={subscriptionBanner(gym.subscriptionStatus as Parameters<typeof subscriptionBanner>[0])}>
      {children}
    </AppShell>
  )
}

export async function trainerFrameProps(gym: Gym, user: User): Promise<FrameProps> {
  return frameFor(gym, user, 'Today')
}
