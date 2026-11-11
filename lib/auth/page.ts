import 'server-only'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db/client'
import { readAdminSession, readAthleteSession, readStaffSession } from './session'
import type { StaffKind, SubscriptionStatus } from '@/lib/api/types'

// Guards for server components (pages and layouts). proxy.ts already
// redirected anyone without a valid token; these re-check against the DB so
// a disabled account or suspended gym is caught on the very next page load.

export async function requireStaffPage(kinds?: StaffKind[], options: { allowSuspended?: boolean } = {}) {
  const claims = await readStaffSession()
  if (!claims) redirect('/login')
  const user = await prisma.gymUser.findFirst({
    where: { id: claims.sub, gymId: claims.gid, active: true },
    include: {
      gym: { select: { id: true, slug: true, name: true, city: true, subscriptionStatus: true, ownerHandlesDesk: true, athleteLabel: true, athleteLabelPlural: true, sessionMinutes: true } },
      branch: { select: { id: true, name: true } },
    },
  })
  if (!user) redirect('/login?error=disabled')
  if (kinds && !kinds.includes(user.kind)) redirect('/login')
  // Suspended / cancelled gyms: only the owner's billing page works.
  const blocked = user.gym.subscriptionStatus === 'SUSPENDED' || user.gym.subscriptionStatus === 'CANCELLED'
  if (blocked && !options.allowSuspended) redirect(user.kind === 'OWNER' ? '/owner/billing' : '/login?error=suspended')
  return { claims, user, gym: user.gym as typeof user.gym & { subscriptionStatus: SubscriptionStatus } }
}

export async function requireAthletePage(slug: string) {
  const claims = await readAthleteSession()
  if (!claims || claims.slug !== slug) redirect(`/g/${slug}/login`)
  const athlete = await prisma.athlete.findFirst({
    where: { id: claims.sub, gymId: claims.gid, archived: false },
    include: { gym: { select: { id: true, slug: true, name: true, city: true, subscriptionStatus: true, athleteLabel: true, sessionMinutes: true } } },
  })
  if (!athlete) redirect(`/g/${slug}/login`)
  // App activity feeds the at-risk score; write at most once an hour.
  if (!athlete.lastAppAt || Date.now() - athlete.lastAppAt.getTime() > 3600000) {
    await prisma.athlete.updateMany({ where: { id: athlete.id, gymId: athlete.gymId }, data: { lastAppAt: new Date() } }).catch(() => null)
  }
  const status = athlete.gym.subscriptionStatus
  const paused = status === 'READ_ONLY' || status === 'SUSPENDED' || status === 'CANCELLED'
  return { claims, athlete, gym: athlete.gym, paused }
}

export async function requireAdminPage() {
  const claims = await readAdminSession()
  if (!claims) redirect('/admin/login')
  const admin = await prisma.adminUser.findUnique({ where: { id: claims.sub }, select: { id: true, adminId: true, name: true } })
  if (!admin) redirect('/admin/login')
  return { claims, admin }
}
