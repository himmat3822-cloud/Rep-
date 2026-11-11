import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { resolveFeatures } from '@/lib/features'
import { istDateOnly, addDays, formatIstDate } from '@/lib/time'
import { computeWeeklyRisk } from './risk'

// Daily growth jobs (run from /api/cron/attendance after the attendance work):
//  - refresh this week's at-risk list (gyms with the at_risk feature)
//  - morning in-app reminder of lead follow-ups due today (leads_crm)

export async function runGrowthJobs(base: PrismaClient, now: Date = new Date()) {
  const gyms = await base.gym.findMany({ where: { subscriptionStatus: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } }, select: { id: true } })
  const results: { gymId: string; atRisk?: number; followUps?: number; error?: string }[] = []
  for (const gym of gyms) {
    try {
      const [subscription, override] = await Promise.all([
        base.gymSubscription.findUnique({ where: { gymId: gym.id }, select: { plan: { select: { features: true } } } }),
        base.gymOverride.findUnique({ where: { gymId: gym.id }, select: { extraFeatures: true, removedFeatures: true } }),
      ])
      const features = subscription ? resolveFeatures(subscription.plan.features, override?.extraFeatures ?? [], override?.removedFeatures ?? []) : []
      const db = scopeToGym(base, gym.id)
      const row: (typeof results)[number] = { gymId: gym.id }
      if (features.includes('at_risk')) row.atRisk = (await computeWeeklyRisk(db, gym.id, now)).atRisk
      if (features.includes('leads_crm')) row.followUps = await remindFollowUps(db, gym.id, now)
      results.push(row)
    } catch (error) {
      console.error('[growth-jobs] gym failed', gym.id, error)
      results.push({ gymId: gym.id, error: error instanceof Error ? error.message : 'failed' })
    }
  }
  return results
}

// One in-app notification per staff member with their follow-ups for today.
export async function remindFollowUps(db: ReturnType<typeof scopeToGym>, gymId: string, now: Date = new Date()) {
  const end = addDays(istDateOnly(now), 1)
  const due = await db.lead.findMany({ where: { stage: { in: ['NEW', 'TRIAL', 'FOLLOW_UP'] }, nextFollowUpAt: { lt: new Date(end.getTime() - 330 * 60000) } }, select: { id: true, name: true, assignedToId: true } })
  if (due.length === 0) return 0
  const owners = await db.gymUser.findMany({ where: { kind: 'OWNER', active: true }, select: { id: true } })
  const byPerson = new Map<string, string[]>()
  for (const lead of due) {
    const targets = lead.assignedToId ? [lead.assignedToId] : owners.map((o) => o.id)
    for (const id of targets) byPerson.set(id, [...(byPerson.get(id) ?? []), lead.name])
  }
  const date = formatIstDate(now, { day: 'numeric', month: 'short' })
  await db.notification.createMany({
    data: [...byPerson.entries()].map(([recipientId, names]) => ({
      gymId,
      recipientType: 'STAFF' as const,
      recipientId,
      title: `${names.length} lead follow-up${names.length === 1 ? '' : 's'} for ${date}`,
      body: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`,
      href: '/owner/leads?view=today',
    })),
  })
  return due.length
}
