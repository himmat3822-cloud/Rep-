import type { ReactNode } from 'react'
import { AppShell, type FrameProps } from '@/components/shell/app-shell'
import type { requireStaffPage } from '@/lib/auth/page'
import { deskNav, ownerBottomNav, ownerNav, subscriptionBanner } from '@/lib/nav'
import { branchNavItem, getBranchView, viewDb, type BranchView } from '@/lib/owner/branch-view'
import { mondayOf } from '@/lib/attendance/jobs'
import { RISK_THRESHOLD } from '@/lib/owner/risk'
import { istDateOnly } from '@/lib/time'
import { openQueryCount } from '@/lib/queries/service'
import { getOwnerTraining, switchToTrainer } from '@/lib/trainer/coaches'

// Shared frame for owner and front desk pages. The nav depends on who is
// logged in and whether the owner also runs the reception.

export type StaffPageContext = Awaited<ReturnType<typeof requireStaffPage>>

function ownerSubtitle(gym: { name: string; city: string }, view: BranchView): string {
  return view.branchName ? `${gym.name} - ${view.branchName}` : `${gym.name} - ${gym.city}`
}

// Nav badges: this week's at-risk list not yet called, and member queries
// waiting for a reply.
export async function ownerCounts(gymId: string, userId: string, isOwner: boolean): Promise<{ atRisk: number; queries: number }> {
  if (!isOwner) return { atRisk: 0, queries: 0 }
  const db = await viewDb(gymId, true)
  const [atRisk, queries] = await Promise.all([
    db.riskScore.count({ where: { weekOf: mondayOf(istDateOnly()), score: { gte: RISK_THRESHOLD }, contacted: false } }),
    openQueryCount(db, { id: userId, kind: 'OWNER' }),
  ])
  return { atRisk, queries }
}

// Initial frame for app/owner and app/desk layouts (pages refine it).
export async function staffFrameProps(ctx: StaffPageContext): Promise<FrameProps> {
  const { user, gym } = ctx
  const isOwner = user.kind === 'OWNER'
  const [{ atRisk, queries }, view, training] = await Promise.all([ownerCounts(gym.id, user.id, isOwner), getBranchView(gym.id, isOwner), isOwner ? getOwnerTraining(gym.id) : null])
  return {
    workspace: isOwner ? 'YOUR WORKSPACE' : 'FRONT DESK',
    kicker: isOwner ? 'Control centre' : gym.name,
    title: isOwner ? 'Overview' : 'Today',
    sections: isOwner ? ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, atRisk, queries, branchNavItem(view), training) : deskNav(gym.athleteLabelPlural),
    bottom: isOwner ? ownerBottomNav : [],
    profile: { name: user.name, subtitle: isOwner ? ownerSubtitle(gym, view) : `Front desk - ${user.branch?.name ?? gym.city}` },
    logout: 'staff',
    switchTo: switchToTrainer(training),
  }
}

export async function StaffShell({ ctx, title, kicker, children }: { ctx: StaffPageContext; title: string; kicker?: string; children: ReactNode }) {
  const { claims, user, gym } = ctx
  const isOwner = user.kind === 'OWNER'
  const [{ atRisk, queries }, view, training] = await Promise.all([ownerCounts(gym.id, user.id, isOwner), getBranchView(gym.id, isOwner), isOwner ? getOwnerTraining(gym.id) : null])
  const impersonation = claims.imp ? { adminName: claims.impName ?? 'Rep+ admin', mode: claims.ro ? ('read' as const) : ('write' as const) } : null
  return (
    <AppShell
      workspace={isOwner ? 'YOUR WORKSPACE' : 'FRONT DESK'}
      kicker={kicker ?? (isOwner ? 'Control centre' : gym.name)}
      title={title}
      sections={isOwner ? ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, atRisk, queries, branchNavItem(view), training) : deskNav(gym.athleteLabelPlural)}
      bottom={isOwner ? ownerBottomNav : []}
      profile={{ name: user.name, subtitle: isOwner ? ownerSubtitle(gym, view) : `Front desk - ${user.branch?.name ?? gym.city}` }}
      logout="staff"
      switchTo={switchToTrainer(training)}
      impersonation={impersonation}
      banner={subscriptionBanner(gym.subscriptionStatus)}
    >
      {children}
    </AppShell>
  )
}

// Base path for shared screens: owner sees /owner/..., desk staff /desk/...
export function areaBase(ctx: StaffPageContext): '/owner' | '/desk' {
  return ctx.user.kind === 'OWNER' ? '/owner' : '/desk'
}

// Owner who trains with "together": trainer pages use the owner menu too.
export async function ownerTrainingFrame(gymId: string, user: { id: string; name: string }): Promise<Omit<FrameProps, 'title' | 'kicker'> | null> {
  if ((await getOwnerTraining(gymId)) !== 'together') return null
  const db = await viewDb(gymId, true)
  const gym = await db.gym.findFirst({ select: { name: true, city: true, ownerHandlesDesk: true, athleteLabelPlural: true } })
  if (!gym) return null
  const [{ atRisk, queries }, view] = await Promise.all([ownerCounts(gymId, user.id, true), getBranchView(gymId, true)])
  return {
    workspace: 'YOUR WORKSPACE',
    sections: ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, atRisk, queries, branchNavItem(view), 'together'),
    bottom: ownerBottomNav,
    profile: { name: user.name, subtitle: ownerSubtitle(gym, view) },
    logout: 'staff',
    switchTo: null,
  }
}
