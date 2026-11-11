import type { TenantDb } from '@/lib/db/tenant-core'
import { translate, type Lang } from '@/lib/i18n'
import { addDays, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'
import { notifyAthlete } from './notify'
import type { PushTransport } from './push'

// Badges and challenges. Badge rules live in the BadgeRule table (metric +
// threshold), so new badges need no code as long as they use a known metric.
// Challenges count attendance only - never money or body weight.

export const BADGE_METRICS = ['total_visits', 'streak', 'best_streak', 'visits_before_7am', 'visits_this_month', 'records'] as const
export type BadgeMetric = (typeof BADGE_METRICS)[number]
export type Metrics = Record<BadgeMetric, number>

export function earnedBadgeKeys(rules: { key: string; metric: string; threshold: number; active: boolean }[], metrics: Metrics): string[] {
  return rules.filter((rule) => rule.active && rule.metric in metrics && metrics[rule.metric as BadgeMetric] >= rule.threshold).map((rule) => rule.key)
}

export async function athleteMetrics(db: TenantDb, athlete: { id: string; streakDays: number; bestStreak: number }, now: Date = new Date()): Promise<Metrics> {
  const { year, month } = istParts(now)
  const monthStart = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS)
  const [total, visits, monthCount, records] = await Promise.all([
    db.checkIn.count({ where: { athleteId: athlete.id } }),
    db.checkIn.findMany({ where: { athleteId: athlete.id }, select: { checkedInAt: true } }),
    db.checkIn.count({ where: { athleteId: athlete.id, checkedInAt: { gte: monthStart } } }),
    db.personalRecord.count({ where: { athleteId: athlete.id } }),
  ])
  return {
    total_visits: total,
    streak: athlete.streakDays,
    best_streak: Math.max(athlete.bestStreak, athlete.streakDays),
    visits_before_7am: visits.filter((visit) => istParts(visit.checkedInAt).hour < 7).length,
    visits_this_month: monthCount,
    records,
  }
}

export interface EvaluateResult {
  newBadges: string[]
  challengesUpdated: number
}

export interface BadgeRuleRow {
  key: string
  name: string
  description: string
  icon: string
  metric: string
  threshold: number
  active: boolean
}

export async function evaluateAthlete(db: TenantDb, gym: { id: string; slug: string }, athleteId: string, rules: BadgeRuleRow[], now: Date = new Date(), transport?: PushTransport): Promise<EvaluateResult> {
  const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true, streakDays: true, bestStreak: true, language: true } })
  if (!athlete) return { newBadges: [], challengesUpdated: 0 }
  const today = istDateOnly(now)
  const [owned, challenges, metrics] = await Promise.all([
    db.athleteBadge.findMany({ where: { athleteId }, select: { badgeKey: true } }),
    db.challenge.findMany({ where: { startsAt: { lte: today }, endsAt: { gte: addDays(today, -1) } } }),
    athleteMetrics(db, athlete, now),
  ])

  const award = new Set(earnedBadgeKeys(rules, metrics))
  let challengesUpdated = 0
  for (const challenge of challenges) {
    const from = new Date(challenge.startsAt.getTime() - IST_OFFSET_MS)
    const to = new Date(addDays(challenge.endsAt, 1).getTime() - IST_OFFSET_MS)
    const visits = await db.checkIn.findMany({ where: { athleteId, checkedInAt: { gte: from, lt: to } }, select: { checkedInAt: true } })
    const progress = challenge.metric === 'streak' ? athlete.streakDays : new Set(visits.map((visit) => istDateOnly(visit.checkedInAt).toISOString())).size
    const done = progress >= challenge.target
    const existing = await db.challengeEntry.findFirst({ where: { challengeId: challenge.id, athleteId } })
    if (!existing) {
      await db.challengeEntry.create({ data: { gymId: gym.id, challengeId: challenge.id, athleteId, progress, completedAt: done ? now : null } })
      challengesUpdated += 1
    } else if (existing.progress !== progress || (done && !existing.completedAt)) {
      await db.challengeEntry.update({ where: { id: existing.id }, data: { progress, completedAt: existing.completedAt ?? (done ? now : null) } })
      challengesUpdated += 1
    }
    if (done && challenge.badgeKey) award.add(challenge.badgeKey)
  }

  const have = new Set(owned.map((badge) => badge.badgeKey))
  const fresh = [...award].filter((key) => !have.has(key) && rules.some((rule) => rule.key === key))
  if (fresh.length) {
    await db.athleteBadge.createMany({ data: fresh.map((badgeKey) => ({ gymId: gym.id, athleteId, badgeKey, earnedAt: now })), skipDuplicates: true })
    const lang = athlete.language as Lang
    for (const key of fresh) {
      const rule = rules.find((r) => r.key === key)!
      await notifyAthlete(db, gym, athleteId, { title: translate(lang, 'notif', 'badge', { name: rule.name }), body: translate(lang, 'notif', 'badgeBody', { description: rule.description }), path: '/progress', tag: `badge-${key}` }, transport)
    }
  }
  return { newBadges: fresh, challengesUpdated }
}
