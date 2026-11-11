import type { Metadata } from 'next'
import { AppShell } from '@/components/shell/app-shell'
import { OwnerOverviewView } from '@/components/owner/owner-overview'
import { requireStaffPage } from '@/lib/auth/page'
import { getOwnerOverview } from '@/lib/owner/overview'
import { ownerBottomNav, ownerNav, subscriptionBanner } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { formatIstDate, greetingFor } from '@/lib/time'

export const metadata: Metadata = { title: 'Overview - Rep+' }

export default async function OwnerOverviewPage() {
  const { claims, user, gym } = await requireStaffPage(['OWNER'])
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
  const [data, subscription, notice] = await Promise.all([
    getOwnerOverview(gym.id, gym.sessionMinutes),
    db.gymSubscription.findFirst({ select: { trialEndsAt: true } }),
    db.notification.findFirst({ where: { recipientType: 'STAFF', recipientId: user.id, readAt: null }, orderBy: { createdAt: 'desc' } }),
  ])
  const banner = subscriptionBanner(gym.subscriptionStatus, subscription?.trialEndsAt) ?? (notice ? { tone: 'trial' as const, text: `${notice.title}: ${notice.body}` } : null)

  return (
    <AppShell {...shell} sections={ownerNav(gym.ownerHandlesDesk, gym.athleteLabelPlural, data.atRisk)} banner={banner}>
      <OwnerOverviewView
        data={data}
        firstName={user.name.split(' ')[0]}
        greeting={greetingFor()}
        dateLine={formatIstDate(new Date())}
        athleteLabelPlural={gym.athleteLabelPlural}
        deskTools={gym.ownerHandlesDesk}
      />
    </AppShell>
  )
}
