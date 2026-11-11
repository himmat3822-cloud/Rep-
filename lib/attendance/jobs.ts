import type { Prisma, PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { parseGymSettings } from '@/lib/gym/settings'
import { addDays, istDateOnly, istParts, istStartOfDay } from '@/lib/time'
import { computeAttendanceStatus, computeStreak } from './status'
import { evaluateAthlete } from '@/lib/athlete/badges'

// Nightly attendance jobs (run per gym by /api/cron/attendance):
//  1. auto-checkout visits older than the session length
//  2. membership PENDING -> ACTIVE and ACTIVE -> EXPIRED by date
//  3. recompute every member's status, streak and last visit
//  4. create slots for the next 7 days from opening hours
//  5. materialise planned vs actual per hour x weekday (PeakHourStat)
//  6. badges + challenge progress for members who trained recently

const DAY_MS = 86400000
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export interface GymJobSummary {
  gymId: string
  autoCheckouts: number
  activated: number
  expired: number
  statuses: number
  slotsCreated: number
  peakRows: number
  badges: number
}

function hourOf(value: string): number {
  return Number(value.split(':')[0])
}

export function openHoursFor(openingHours: unknown, weekday: number): number[] {
  const table = (openingHours ?? {}) as Record<string, [string, string] | null | undefined>
  const day = table[DAY_KEYS[weekday]]
  if (day === null) return []
  const [open, close] = day ?? ['06:00', '22:00']
  const start = hourOf(open)
  const end = hourOf(close)
  const hours: number[] = []
  for (let hour = start; hour < end; hour += 1) hours.push(hour)
  return hours
}

export function mondayOf(date: Date): Date {
  const today = istDateOnly(date)
  const weekday = today.getUTCDay()
  return new Date(today.getTime() - ((weekday + 6) % 7) * DAY_MS)
}

export async function runAttendanceJobsForGym(base: PrismaClient, gymId: string, now: Date = new Date()): Promise<GymJobSummary> {
  const db = scopeToGym(base, gymId)
  const gym = await db.gym.findFirstOrThrow({ select: { id: true, slug: true, sessionMinutes: true, settings: true } })
  const settings = parseGymSettings(gym.settings)
  const today = istDateOnly(now)
  const summary: GymJobSummary = { gymId, autoCheckouts: 0, activated: 0, expired: 0, statuses: 0, slotsCreated: 0, peakRows: 0, badges: 0 }

  // 1. auto checkout
  const stale = await db.checkIn.findMany({ where: { checkedOutAt: null, checkedInAt: { lt: new Date(now.getTime() - gym.sessionMinutes * 60000) } }, select: { id: true, checkedInAt: true } })
  for (const visit of stale) {
    await db.checkIn.update({ where: { id: visit.id }, data: { checkedOutAt: new Date(visit.checkedInAt.getTime() + gym.sessionMinutes * 60000), autoCheckout: true } })
  }
  summary.autoCheckouts = stale.length

  // 2. membership lifecycle
  summary.activated = (await db.membership.updateMany({ where: { status: 'PENDING', startsAt: { lte: today } }, data: { status: 'ACTIVE' } })).count
  summary.expired = (await db.membership.updateMany({ where: { status: { in: ['ACTIVE', 'FROZEN'] }, endsAt: { lt: today } }, data: { status: 'EXPIRED' } })).count

  // 3. statuses + streaks
  const [athletes, visits, memberships, branches] = await Promise.all([
    db.athlete.findMany({ where: { archived: false }, select: { id: true, joinedAt: true, restDays: true, bestStreak: true, homeBranchId: true, status: true, streakDays: true, lastVisitAt: true } }),
    db.checkIn.findMany({ where: { checkedInAt: { gte: addDays(istStartOfDay(now), -120) } }, select: { athleteId: true, checkedInAt: true } }),
    db.membership.findMany({ where: { startsAt: { lte: today }, endsAt: { gte: today }, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] } } }),
    db.branch.findMany({ select: { id: true, holidays: true, openingHours: true, hourlyCapacity: true, archived: true } }),
  ])
  const visitsBy = new Map<string, Date[]>()
  for (const visit of visits) visitsBy.set(visit.athleteId, [...(visitsBy.get(visit.athleteId) ?? []), visit.checkedInAt])
  const membershipsBy = new Map<string, typeof memberships>()
  for (const membership of memberships) membershipsBy.set(membership.athleteId, [...(membershipsBy.get(membership.athleteId) ?? []), membership])
  const holidaysBy = new Map(branches.map((branch) => [branch.id, new Set(branch.holidays.map((day) => day.toISOString().slice(0, 10)))]))
  const dayKey = (date: Date) => istDateOnly(date).toISOString().slice(0, 10)
  for (const athlete of athletes) {
    const list = (visitsBy.get(athlete.id) ?? []).sort((a, b) => a.getTime() - b.getTime())
    const running = membershipsBy.get(athlete.id) ?? []
    const frozen = running.length > 0 && running.every((m) => m.frozenFrom && m.frozenUntil && m.frozenFrom <= today && m.frozenUntil >= today)
    const streak = computeStreak(new Set(list.map(dayKey)), now, athlete.restDays, holidaysBy.get(athlete.homeBranchId) ?? new Set(), dayKey, (date) => istParts(date).weekday)
    const last = list.at(-1) ?? athlete.lastVisitAt
    const status = computeAttendanceStatus(
      { now, joinedAt: athlete.joinedAt, lastVisitAt: last, visitsLast14Days: list.filter((date) => date.getTime() >= now.getTime() - 14 * DAY_MS).length, hasActiveMembership: running.length > 0, isFrozen: frozen },
      settings.thresholds,
    )
    if (status !== athlete.status || streak !== athlete.streakDays || (last?.getTime() ?? 0) !== (athlete.lastVisitAt?.getTime() ?? 0)) {
      await db.athlete.update({ where: { id: athlete.id }, data: { status, streakDays: streak, bestStreak: Math.max(athlete.bestStreak, streak), lastVisitAt: last, statusComputedAt: now } })
      summary.statuses += 1
    }
  }

  // 4. slots for the next 7 days
  const slotRows: Prisma.SlotCreateManyInput[] = []
  for (const branch of branches.filter((b) => !b.archived)) {
    const holidays = holidaysBy.get(branch.id) ?? new Set()
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(today.getTime() + d * DAY_MS)
      if (holidays.has(date.toISOString().slice(0, 10))) continue
      for (const hour of openHoursFor(branch.openingHours, date.getUTCDay())) {
        slotRows.push({ gymId, branchId: branch.id, date, startHour: hour, capacity: branch.hourlyCapacity })
      }
    }
  }
  if (slotRows.length) summary.slotsCreated = (await db.slot.createMany({ data: slotRows, skipDuplicates: true })).count

  // 5. planned vs actual (this week and last week)
  for (const weekOf of [mondayOf(now), new Date(mondayOf(now).getTime() - 7 * DAY_MS)]) {
    const weekEnd = new Date(weekOf.getTime() + 7 * DAY_MS)
    const startInstant = new Date(weekOf.getTime() - 330 * 60000)
    const endInstant = new Date(weekEnd.getTime() - 330 * 60000)
    const [actual, slots] = await Promise.all([
      db.checkIn.findMany({ where: { checkedInAt: { gte: startInstant, lt: endInstant } }, select: { branchId: true, checkedInAt: true } }),
      db.slot.findMany({ where: { date: { gte: weekOf, lt: weekEnd } }, select: { branchId: true, date: true, startHour: true, booked: true } }),
    ])
    const cells = new Map<string, { branchId: string; weekday: number; hour: number; planned: number; actual: number }>()
    const cell = (branchId: string, weekday: number, hour: number) => {
      const key = `${branchId}:${weekday}:${hour}`
      if (!cells.has(key)) cells.set(key, { branchId, weekday, hour, planned: 0, actual: 0 })
      return cells.get(key)!
    }
    for (const row of actual) {
      const parts = istParts(row.checkedInAt)
      cell(row.branchId, parts.weekday, parts.hour).actual += 1
    }
    for (const slot of slots) if (slot.booked) cell(slot.branchId, slot.date.getUTCDay(), slot.startHour).planned += slot.booked
    for (const value of cells.values()) {
      await db.peakHourStat.upsert({
        where: { gymId_branchId_weekOf_weekday_hour: { gymId, branchId: value.branchId, weekOf, weekday: value.weekday, hour: value.hour } },
        create: { gymId, branchId: value.branchId, weekOf, weekday: value.weekday, hour: value.hour, planned: value.planned, actual: value.actual },
        update: { planned: value.planned, actual: value.actual },
      })
    }
    summary.peakRows += cells.size
  }
  // 6. badges and challenge progress for everyone who trained in the last 2 days
  //    (biometric and register check-ins do not run the instant evaluation)
  const rules = await base.badgeRule.findMany({ where: { active: true } })
  const recent = await db.checkIn.findMany({ where: { checkedInAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } }, select: { athleteId: true }, distinct: ['athleteId'] })
  for (const row of recent) {
    const result = await evaluateAthlete(db, { id: gym.id, slug: gym.slug }, row.athleteId, rules, now)
    summary.badges += result.newBadges.length
  }

  return summary
}

export async function runAttendanceJobs(base: PrismaClient, now: Date = new Date()) {
  const gyms = await base.gym.findMany({ where: { subscriptionStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } }, select: { id: true } })
  const results: GymJobSummary[] = []
  for (const gym of gyms) {
    try {
      results.push(await runAttendanceJobsForGym(base, gym.id, now))
    } catch (error) {
      console.error('[attendance-jobs] gym failed', gym.id, error)
    }
  }
  return results
}
