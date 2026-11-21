import type { Metadata } from 'next'
import { AppShell } from '@/components/shell/app-shell'
import { OwnerOverviewView } from '@/components/owner/owner-overview'
import { requireStaffPage } from '@/lib/auth/page'
import { getBranchComparison, getOwnerOverview } from '@/lib/owner/overview'
import { BranchCompare, BranchSwitch } from '@/components/owner/branch-switch'
import { getGymFeatures } from '@/lib/gym/features'
import { ownerBottomNav, ownerNav, subscriptionBanner } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { formatIstDate, greetingFor } from '@/lib/time'
import { openQueryCount } from '@/lib/queries/service'

export const metadata: Metadata = { title: 'Overview - Rep+' }

export default async function OwnerOverviewPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { claims, user, gym } = await requireStaffPage(['OWNER'])
  const requested = (await searchParams).branch ?? null
  const impersonation = claims.imp ? { adminName: claims.impName ?? 'Rep+ admin', mode: claims.ro ? ('read' as const) : ('write' as const) } : null
  const shell = {
    workspace: 'YOUR WORKSPACE',
    kicker: 'Control centre',
    title: 'Overview',
    bottom: ownerBottomNav,
    profile: { name: user.name, subtitle: `${gym.name} - ${gym.city}` },
    logout: 'staff' as const,
    impersonation,
  }

  const db = tenantDb(gym.id)
  const [branches, features] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    getGymFeatures(gym.id),
  ])
  // Branch switch and comparison: Elite (multi_branch) with 2+ branches.
  const multi = branches.length > 1 && features.includes('multi_branch')
  const branchId = multi && branches.some((branch) => branch.id === requested) ? requested : null
  const [data, subscription, notice, queries, compare] = await Promise.all([
    getOwnerOverview(gym.id, gym.sessionMinutes, branchId),
    db.gymSubscription.findFirst({ select: { trialEndsAt: true } }),
    db.notification.findFirst({ where: { recipientType: 'STAFF', recipientId: user.id, readAt: null }, orderBy: { createdAt: 'desc' } }),
    openQueryCount(db, { id: user.id, kind: 'OWNER' }),
    multi && !branchId ? getBranchComparison(gym.id, gym.sessionMinutes) : Promise.resolve(null),
  ])
  const branchName = branchId ? branches.find((branch) => branch.id === branchId)?.name : null
  const banner = subscriptionBanner(gym.subscriptionStatus, subscription?.trialEndsAt) ?? (notice ? { tone: 'trial' as const, text: `${notice.title}: ${notice.body}` } : null)

  return (
    <AppShell {...shell} kicker={branchName ? `Control centre - ${branchName}` : shell.kicker} sections={ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, data.atRisk, queries)} banner={banner}>
      {multi ? <BranchSwitch base="/owner" branches={branches} active={branchId} /> : null}
      <OwnerOverviewView
        data={data}
        firstName={user.name.split(' ')[0]}
        greeting={greetingFor()}
        dateLine={formatIstDate(new Date())}
        athleteLabelPlural={gym.athleteLabelPlural}
        deskTools={gym.ownerHandlesDesk}
        branchName={branchName ?? null}
        compare={compare ? <BranchCompare base="/owner" cards={compare} /> : null}
      />
    </AppShell>
  )
}
