import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { mondayOf } from '@/lib/attendance/jobs'
import { RISK_THRESHOLD } from './risk'
import { addDays, formatHour, formatIstTime, istParts, istStartOfDay, istStartOfMonth, WEEKDAY_SHORT } from '@/lib/time'

// Everything on the owner Overview, computed live through the tenant layer.

export interface OwnerOverview {
  activeMembers: number
  newThisMonth: number
  collectedThisMonthPaise: number
  collectedLastMonthSamePeriodPaise: number
  todayCheckIns: number
  sameDayLastWeekCheckIns: number
  pendingDuesPaise: number
  pendingDuesCount: number
  renewalsNext7Days: number
  atRisk: number
  week: { label: string; count: number; isToday: boolean }[]
  floor: { inside: number; capacity: number; percent: number; bestTime: string | null; nextRush: string | null; nextRushPercent: number | null }
  latest: { id: string; name: string; time: string; branch: string }[]
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function describeChange(current: number, previous: number, suffix: string): string {
  const change = pctChange(current, previous)
  if (change === null) return `No data ${suffix}`
  return `${change >= 0 ? '+' : ''}${change}% ${suffix}`
}

export async function getOwnerOverview(gymId: string, sessionMinutes: number): Promise<OwnerOverview> {
  const db = tenantDb(gymId)
  const now = new Date()
  const todayStart = istStartOfDay(now)
  const monthStart = istStartOfMonth(now)
  const lastMonthStart = istStartOfMonth(addDays(monthStart, -1))
  const lastMonthSamePoint = new Date(lastMonthStart.getTime() + (now.getTime() - monthStart.getTime()))
  const weekStart = addDays(todayStart, -6)
  const todayDateOnly = new Date(Date.UTC(istParts(now).year, istParts(now).month, istParts(now).day))

  const [
    activeMembers,
    newThisMonth,
    collected,
    collectedPrev,
    todayCheckIns,
    sameDayLastWeekCheckIns,
    dues,
    renewals,
    atRisk,
    weekRows,
    inside,
    branches,
    latest,
    history,
  ] = await Promise.all([
    db.membership.count({ where: { status: 'ACTIVE', endsAt: { gte: todayDateOnly } } }),
    db.athlete.count({ where: { joinedAt: { gte: monthStart }, archived: false } }),
    db.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
    db.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: lastMonthStart, lt: lastMonthSamePoint } }, _sum: { amountPaise: true } }),
    db.checkIn.count({ where: { checkedInAt: { gte: todayStart } } }),
    db.checkIn.count({ where: { checkedInAt: { gte: addDays(todayStart, -7), lt: addDays(now, -7) } } }),
    db.due.aggregate({ where: { status: 'OPEN' }, _sum: { amountPaise: true }, _count: { _all: true } }),
    db.membership.count({ where: { status: 'ACTIVE', endsAt: { gte: todayDateOnly, lte: addDays(todayDateOnly, 7) } } }),
    // This week's ranked call list, minus members already contacted.
    db.riskScore.count({ where: { weekOf: mondayOf(todayDateOnly), score: { gte: RISK_THRESHOLD }, contacted: false } }),
    db.checkIn.findMany({ where: { checkedInAt: { gte: weekStart } }, select: { checkedInAt: true } }),
    db.checkIn.count({ where: { checkedOutAt: null, checkedInAt: { gte: new Date(now.getTime() - sessionMinutes * 60 * 1000) } } }),
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true, hourlyCapacity: true } }),
    db.checkIn.findMany({ orderBy: { checkedInAt: 'desc' }, take: 5, select: { id: true, athleteId: true, branchId: true, checkedInAt: true } }),
    db.checkIn.findMany({ where: { checkedInAt: { gte: addDays(todayStart, -28), lt: todayStart } }, select: { checkedInAt: true } }),
  ])

  // Last 7 days, oldest first
  const week = Array.from({ length: 7 }, (_, index) => {
    const dayStart = addDays(weekStart, index)
    return { start: dayStart.getTime(), end: addDays(dayStart, 1).getTime(), label: WEEKDAY_SHORT[istParts(dayStart).weekday], isToday: index === 6, count: 0 }
  })
  for (const row of weekRows) {
    const t = row.checkedInAt.getTime()
    const bucket = week.find((day) => t >= day.start && t < day.end)
    if (bucket) bucket.count += 1
  }

  // Floor pulse: same-weekday hourly averages over the last 4 weeks
  const capacity = branches.reduce((sum, branch) => sum + branch.hourlyCapacity, 0)
  const todayWeekday = istParts(now).weekday
  const hourly = new Array<number>(24).fill(0)
  for (const row of history) {
    const parts = istParts(row.checkedInAt)
    if (parts.weekday === todayWeekday) hourly[parts.hour] += 1
  }
  const nowHour = istParts(now).hour
  const upcoming = hourly.map((count, hour) => ({ hour, avg: count / 4 })).filter((entry) => entry.hour > nowHour && entry.hour >= 6 && entry.hour <= 21)
  const best = upcoming.length ? upcoming.reduce((a, b) => (b.avg < a.avg ? b : a)) : null
  const rush = upcoming.length ? upcoming.reduce((a, b) => (b.avg > a.avg ? b : a)) : null

  const athleteNames = latest.length ? await db.athlete.findMany({ where: { id: { in: latest.map((row) => row.athleteId) } }, select: { id: true, name: true } }) : []
  const nameById = new Map(athleteNames.map((athlete) => [athlete.id, athlete.name]))
  const branchById = new Map(branches.map((branch) => [branch.id, branch.name]))

  return {
    activeMembers,
    newThisMonth,
    collectedThisMonthPaise: collected._sum.amountPaise ?? 0,
    collectedLastMonthSamePeriodPaise: collectedPrev._sum.amountPaise ?? 0,
    todayCheckIns,
    sameDayLastWeekCheckIns,
    pendingDuesPaise: dues._sum.amountPaise ?? 0,
    pendingDuesCount: dues._count._all,
    renewalsNext7Days: renewals,
    atRisk,
    week: week.map(({ label, count, isToday }) => ({ label, count, isToday })),
    floor: {
      inside,
      capacity,
      percent: capacity ? Math.min(100, Math.round((inside / capacity) * 100)) : 0,
      bestTime: best ? `${formatHour(best.hour)} - ${formatHour(best.hour + 1)}` : null,
      nextRush: rush ? formatHour(rush.hour) : null,
      nextRushPercent: rush && capacity ? Math.min(100, Math.round((rush.avg / capacity) * 100)) : null,
    },
    latest: latest.map((row) => ({ id: row.id, name: nameById.get(row.athleteId) ?? 'Unknown', time: formatIstTime(row.checkedInAt), branch: branchById.get(row.branchId) ?? '' })),
  }
}
