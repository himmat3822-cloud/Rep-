import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import type { requireStaffPage } from '@/lib/auth/page'
import { deskNav, ownerBottomNav, ownerNav, subscriptionBanner } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { mondayOf } from '@/lib/attendance/jobs'
import { RISK_THRESHOLD } from '@/lib/owner/risk'
import { istDateOnly } from '@/lib/time'

// Shared frame for owner and front desk pages. The nav depends on who is
// logged in and whether the owner also runs the reception.

export type StaffPageContext = Awaited<ReturnType<typeof requireStaffPage>>

export async function StaffShell({ ctx, title, kicker, children }: { ctx: StaffPageContext; title: string; kicker?: string; children: ReactNode }) {
  const { claims, user, gym } = ctx
  const isOwner = user.kind === 'OWNER'
  // Badge on the At-risk nav item: this week's list, not yet called.
  const atRisk = isOwner ? await tenantDb(gym.id).riskScore.count({ where: { weekOf: mondayOf(istDateOnly()), score: { gte: RISK_THRESHOLD }, contacted: false } }) : 0
  const impersonation = claims.imp ? { adminName: claims.impName ?? 'Rep+ admin', mode: claims.ro ? ('read' as const) : ('write' as const) } : null
  return (
    <AppShell
      workspace={isOwner ? 'YOUR WORKSPACE' : 'FRONT DESK'}
      kicker={kicker ?? (isOwner ? 'Control centre' : gym.name)}
      title={title}
      sections={isOwner ? ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, atRisk) : deskNav(gym.athleteLabelPlural)}
      bottom={isOwner ? ownerBottomNav : []}
      profile={{ name: user.name, subtitle: isOwner ? `${gym.name} - ${gym.city}` : `Front desk - ${user.branch?.name ?? gym.city}` }}
      logout="staff"
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
