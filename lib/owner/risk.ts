import type { TenantDb } from '@/lib/db/tenant-core'
import { addDays, daysBetween, istDateOnly, IST_OFFSET_MS } from '@/lib/time'
import { mondayOf } from '@/lib/attendance/jobs'

// At-risk list: a weekly "call these members" list.
// Score 0-100 from four signals, each with a reason the owner can read:
//   attendance drop vs the member's own normal   up to 40
//   days since the last visit                    up to 20
//   payments: overdue dues, late payments        up to 25
//   plan ending soon without a renewal           up to 15
//   no app activity in 30 days                   10
// Members at or above RISK_THRESHOLD go on the list.

export const RISK_THRESHOLD = 35

export interface RiskInput {
  visitsLast14: number
  visitsPrev56: number // the 8 weeks before that
  daysSinceLastVisit: number | null // null = never visited
  overdueDues: number
  overdueDays: number // oldest overdue due
  latePayments90: number // dues paid after their due date, last 90 days
  planDaysLeft: number | null // null = no running plan
  renewed: boolean
  appDaysIdle: number | null // null = never opened the app
  memberDays: number // days since joining
}

export interface RiskResult {
  score: number
  reasons: string[]
}

export function computeRisk(input: RiskInput): RiskResult {
  let score = 0
  const reasons: string[] = []

  // 1. Attendance drop vs their own normal (needs some history to compare).
  const normal14 = input.visitsPrev56 / 4
  if (input.memberDays >= 21 && normal14 >= 2) {
    const drop = Math.max(0, 1 - input.visitsLast14 / normal14)
    if (drop >= 0.25) {
      const points = Math.round(Math.min(1, drop) * 40)
      score += points
      reasons.push(`Visits down ${Math.round(drop * 100)}% (${input.visitsLast14} in 2 weeks vs usual ${Math.round(normal14)})`)
    }
  }

  // 2. Gone quiet.
  if (input.daysSinceLastVisit === null) {
    if (input.memberDays >= 7) {
      score += 20
      reasons.push('Has not checked in since joining')
    }
  } else if (input.daysSinceLastVisit >= 14) {
    score += 20
    reasons.push(`No visit in ${input.daysSinceLastVisit} days`)
  } else if (input.daysSinceLastVisit >= 7) {
    score += 10
    reasons.push(`No visit in ${input.daysSinceLastVisit} days`)
  }

  // 3. Money signals.
  if (input.overdueDues > 0) {
    const points = input.overdueDays >= 15 ? 20 : input.overdueDays >= 5 ? 15 : 10
    score += points
    reasons.push(`Payment overdue by ${input.overdueDays} day${input.overdueDays === 1 ? '' : 's'}`)
  }
  if (input.latePayments90 >= 2) {
    score += 5
    reasons.push(`Paid late ${input.latePayments90} times in 90 days`)
  }

  // 4. Plan ending without a renewal.
  if (!input.renewed && input.planDaysLeft !== null) {
    if (input.planDaysLeft <= 7) {
      score += 15
      reasons.push(input.planDaysLeft <= 0 ? 'Plan ends today' : `Plan ends in ${input.planDaysLeft} day${input.planDaysLeft === 1 ? '' : 's'}, not renewed`)
    } else if (input.planDaysLeft <= 14) {
      score += 8
      reasons.push(`Plan ends in ${input.planDaysLeft} days, not renewed`)
    }
  }

  // 5. App inactivity (only meaningful once they have been a member a while).
  if (input.memberDays >= 30 && (input.appDaysIdle === null || input.appDaysIdle >= 30)) {
    score += 10
    reasons.push(input.appDaysIdle === null ? 'Never opened the member app' : `App not opened in ${input.appDaysIdle} days`)
  }

  return { score: Math.min(100, score), reasons }
}

export function riskLevel(score: number): 'high' | 'medium' | 'low' {
  return score >= 60 ? 'high' : score >= RISK_THRESHOLD ? 'medium' : 'low'
}

// Scores every member with a running plan (or one that ended in the last
// 14 days) and stores this week's list. Contact outcomes already recorded
// this week are kept.
export async function computeWeeklyRisk(db: TenantDb, gymId: string, now: Date = new Date()): Promise<{ weekOf: Date; scored: number; atRisk: number }> {
  const today = istDateOnly(now)
  const weekOf = mondayOf(today)
  const memberships = await db.membership.findMany({ where: { status: { in: ['ACTIVE', 'FROZEN', 'PENDING', 'EXPIRED'] }, endsAt: { gte: addDays(today, -14) } }, select: { athleteId: true, status: true, startsAt: true, endsAt: true } })
  const ids = [...new Set(memberships.map((m) => m.athleteId))]
  if (ids.length === 0) return { weekOf, scored: 0, atRisk: 0 }

  const since70 = new Date(addDays(today, -70).getTime() - IST_OFFSET_MS)
  const since14 = new Date(addDays(today, -13).getTime() - IST_OFFSET_MS)
  const [athletes, visits, dues, paidDues] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, joinedAt: true, lastVisitAt: true, lastAppAt: true, status: true } }),
    db.checkIn.findMany({ where: { athleteId: { in: ids }, checkedInAt: { gte: since70 } }, select: { athleteId: true, checkedInAt: true } }),
    db.due.findMany({ where: { athleteId: { in: ids }, status: 'OPEN', dueDate: { lt: today } }, select: { athleteId: true, dueDate: true } }),
    db.due.findMany({ where: { athleteId: { in: ids }, status: 'PAID', dueDate: { gte: addDays(today, -90) } }, select: { athleteId: true, dueDate: true, paidAt: true } }),
  ])

  const recent = new Map<string, number>()
  const previous = new Map<string, number>()
  const dayKey = (d: Date) => istDateOnly(d).toISOString()
  const seen = new Set<string>()
  for (const visit of visits) {
    const key = `${visit.athleteId}:${dayKey(visit.checkedInAt)}`
    if (seen.has(key)) continue
    seen.add(key)
    const map = visit.checkedInAt >= since14 ? recent : previous
    map.set(visit.athleteId, (map.get(visit.athleteId) ?? 0) + 1)
  }

  const rows: { athleteId: string; score: number; reasons: string[] }[] = []
  for (const athlete of athletes) {
    if (athlete.status === 'FROZEN') continue
    const mine = memberships.filter((m) => m.athleteId === athlete.id)
    const running = mine.filter((m) => m.status !== 'EXPIRED' && m.endsAt >= today).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())
    const current = running.find((m) => m.startsAt <= today) ?? running[0] ?? mine.sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0]
    const renewed = running.some((m) => m.startsAt > today) || running.length > 1
    const overdue = dues.filter((d) => d.athleteId === athlete.id)
    const oldest = overdue.reduce<Date | null>((min, d) => (!min || d.dueDate < min ? d.dueDate : min), null)
    const result = computeRisk({
      visitsLast14: recent.get(athlete.id) ?? 0,
      visitsPrev56: previous.get(athlete.id) ?? 0,
      daysSinceLastVisit: athlete.lastVisitAt ? daysBetween(istDateOnly(athlete.lastVisitAt), today) : null,
      overdueDues: overdue.length,
      overdueDays: oldest ? daysBetween(oldest, today) : 0,
      latePayments90: paidDues.filter((d) => d.athleteId === athlete.id && d.paidAt && istDateOnly(d.paidAt) > d.dueDate).length,
      planDaysLeft: current ? daysBetween(today, current.endsAt) : null,
      renewed,
      appDaysIdle: athlete.lastAppAt ? daysBetween(istDateOnly(athlete.lastAppAt), today) : null,
      memberDays: daysBetween(istDateOnly(athlete.joinedAt), today),
    })
    rows.push({ athleteId: athlete.id, ...result })
  }

  const existing = await db.riskScore.findMany({ where: { weekOf }, select: { athleteId: true } })
  const have = new Set(existing.map((r) => r.athleteId))
  const listed = rows.filter((r) => r.score >= RISK_THRESHOLD)
  for (const row of listed) {
    if (have.has(row.athleteId)) {
      // Refresh the score but keep the contact outcome.
      await db.riskScore.updateMany({ where: { athleteId: row.athleteId, weekOf }, data: { score: row.score, reasons: row.reasons } })
    } else {
      await db.riskScore.create({ data: { gymId, athleteId: row.athleteId, weekOf, score: row.score, reasons: row.reasons } })
    }
  }
  // Members who recovered since the last run drop off (unless already contacted).
  const keep = new Set(listed.map((r) => r.athleteId))
  await db.riskScore.deleteMany({ where: { weekOf, contacted: false, athleteId: { notIn: [...keep] } } })
  return { weekOf, scored: rows.length, atRisk: listed.length }
}
