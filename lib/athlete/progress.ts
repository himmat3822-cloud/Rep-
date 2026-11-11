import type { TenantDb } from '@/lib/db/tenant-core'
import { addDays, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'

// Data for the Progress tab: attendance heatmap, monthly summary and the
// attendance-only leaderboard (never weight, never money).

export const HEATMAP_DAYS = 182

export interface HeatCell {
  date: string
  count: number
}

export async function attendanceHeatmap(db: TenantDb, athleteId: string, now: Date = new Date()): Promise<HeatCell[]> {
  const today = istDateOnly(now)
  const start = addDays(today, -(HEATMAP_DAYS - 1))
  const visits = await db.checkIn.findMany({ where: { athleteId, checkedInAt: { gte: new Date(start.getTime() - IST_OFFSET_MS) } }, select: { checkedInAt: true } })
  const counts = new Map<string, number>()
  for (const visit of visits) {
    const key = istDateOnly(visit.checkedInAt).toISOString().slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from({ length: HEATMAP_DAYS }, (_, i) => {
    const date = addDays(start, i).toISOString().slice(0, 10)
    return { date, count: counts.get(date) ?? 0 }
  })
}

// Longest run of consecutive days with a visit inside a list of IST dates.
export function longestRun(dates: string[]): number {
  const sorted = [...new Set(dates)].sort()
  let best = 0
  let run = 0
  let previous: number | null = null
  for (const iso of sorted) {
    const day = Date.parse(`${iso}T00:00:00Z`) / 86400000
    run = previous !== null && day - previous === 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }
  return best
}

export interface MonthSummary {
  month: string
  visits: number
  bestStreak: number
  weightChange: number | null
  newRecords: number
}

export async function monthSummary(db: TenantDb, athleteId: string, now: Date = new Date()): Promise<MonthSummary> {
  const { year, month } = istParts(now)
  const monthStart = new Date(Date.UTC(year, month, 1))
  const from = new Date(monthStart.getTime() - IST_OFFSET_MS)
  const [visits, logs, records] = await Promise.all([
    db.checkIn.findMany({ where: { athleteId, checkedInAt: { gte: from } }, select: { checkedInAt: true } }),
    db.progressLog.findMany({ where: { athleteId, loggedOn: { gte: monthStart }, weightKg: { not: null } }, orderBy: { loggedOn: 'asc' }, select: { weightKg: true } }),
    db.personalRecord.count({ where: { athleteId, achievedOn: { gte: monthStart } } }),
  ])
  const days = visits.map((visit) => istDateOnly(visit.checkedInAt).toISOString().slice(0, 10))
  const weights = logs.map((log) => log.weightKg!).filter((w) => w !== null)
  return {
    month: new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(monthStart),
    visits: new Set(days).size,
    bestStreak: longestRun(days),
    weightChange: weights.length > 1 ? Math.round((weights[weights.length - 1] - weights[0]) * 10) / 10 : null,
    newRecords: records,
  }
}

export interface LeaderRow {
  rank: number
  athleteId: string
  name: string
  workouts: number
  streak: number
  me: boolean
}

// Ranked by distinct workout days this month, then by current streak.
export async function leaderboard(db: TenantDb, athleteId: string, now: Date = new Date(), limit = 20): Promise<{ rows: LeaderRow[]; me: LeaderRow | null; hidden: boolean }> {
  const { year, month } = istParts(now)
  const from = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS)
  const [visits, athletes, self] = await Promise.all([
    db.checkIn.findMany({ where: { checkedInAt: { gte: from } }, select: { athleteId: true, checkedInAt: true } }),
    db.athlete.findMany({ where: { archived: false, hideFromLeaderboard: false }, select: { id: true, name: true, streakDays: true } }),
    db.athlete.findFirst({ where: { id: athleteId }, select: { hideFromLeaderboard: true } }),
  ])
  const days = new Map<string, Set<string>>()
  for (const visit of visits) {
    const set = days.get(visit.athleteId) ?? new Set<string>()
    set.add(istDateOnly(visit.checkedInAt).toISOString().slice(0, 10))
    days.set(visit.athleteId, set)
  }
  const ranked = athletes
    .map((athlete) => ({ athleteId: athlete.id, name: shortName(athlete.name), workouts: days.get(athlete.id)?.size ?? 0, streak: athlete.streakDays }))
    .filter((row) => row.workouts > 0)
    .sort((a, b) => b.workouts - a.workouts || b.streak - a.streak || a.name.localeCompare(b.name))
  let rank = 0
  let previous: { workouts: number; streak: number } | null = null
  const withRank = ranked.map((row, index) => {
    if (!previous || previous.workouts !== row.workouts || previous.streak !== row.streak) rank = index + 1
    previous = row
    return { ...row, rank, me: row.athleteId === athleteId }
  })
  return { rows: withRank.slice(0, limit), me: withRank.find((row) => row.me) ?? null, hidden: Boolean(self?.hideFromLeaderboard) }
}

// "Arjun M." - first name + initial, so the board does not show full names.
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}
