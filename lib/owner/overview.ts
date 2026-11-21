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

// branchId: one branch only (multi-branch owners switch between branches);
// null or undefined: the whole gym.
export async function getOwnerOverview(gymId: string, sessionMinutes: number, branchId?: string | null): Promise<OwnerOverview> {
  const db = tenantDb(gymId)
  const now = new Date()
  // Money, plans, dues and risk rows have no branch column: they follow the
  // member's home branch.
  const branchAthletes = branchId ? (await db.athlete.findMany({ where: { homeBranchId: branchId }, select: { id: true } })).map((row) => row.id) : null
  const A = branchAthletes ? { athleteId: { in: branchAthletes } } : {}
  const B = branchId ? { branchId } : {}
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
    db.membership.count({ where: { ...A, status: 'ACTIVE', endsAt: { gte: todayDateOnly } } }),
    db.athlete.count({ where: { ...(branchId ? { homeBranchId: branchId } : {}), joinedAt: { gte: monthStart }, archived: false } }),
    db.payment.aggregate({ where: { ...A, status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
    db.payment.aggregate({ where: { ...A, status: 'PAID', paidAt: { gte: lastMonthStart, lt: lastMonthSamePoint } }, _sum: { amountPaise: true } }),
    db.checkIn.count({ where: { ...B, checkedInAt: { gte: todayStart } } }),
    db.checkIn.count({ where: { ...B, checkedInAt: { gte: addDays(todayStart, -7), lt: addDays(now, -7) } } }),
    db.due.aggregate({ where: { ...A, status: 'OPEN' }, _sum: { amountPaise: true }, _count: { _all: true } }),
    db.membership.count({ where: { ...A, status: 'ACTIVE', endsAt: { gte: todayDateOnly, lte: addDays(todayDateOnly, 7) } } }),
    // This week's ranked call list, minus members already contacted.
    db.riskScore.count({ where: { ...A, weekOf: mondayOf(todayDateOnly), score: { gte: RISK_THRESHOLD }, contacted: false } }),
    db.checkIn.findMany({ where: { ...B, checkedInAt: { gte: weekStart } }, select: { checkedInAt: true } }),
    db.checkIn.count({ where: { ...B, checkedOutAt: null, checkedInAt: { gte: new Date(now.getTime() - sessionMinutes * 60 * 1000) } } }),
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true, hourlyCapacity: true } }),
    db.checkIn.findMany({ where: B, orderBy: { checkedInAt: 'desc' }, take: 5, select: { id: true, athleteId: true, branchId: true, checkedInAt: true } }),
    db.checkIn.findMany({ where: { ...B, checkedInAt: { gte: addDays(todayStart, -28), lt: todayStart } }, select: { checkedInAt: true } }),
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
  const capacity = branches.filter((branch) => !branchId || branch.id === branchId).reduce((sum, branch) => sum + branch.hourlyCapacity, 0)
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

export interface BranchCard {
  id: string
  name: string
  activeMembers: number
  todayCheckIns: number
  inside: number
  capacity: number
  percent: number
  collectedThisMonthPaise: number
  pendingDuesPaise: number
  atRisk: number
}

// Side-by-side numbers for owners with more than one branch.
export async function getBranchComparison(gymId: string, sessionMinutes: number): Promise<BranchCard[]> {
  const db = tenantDb(gymId)
  const now = new Date()
  const todayStart = istStartOfDay(now)
  const monthStart = istStartOfMonth(now)
  const todayDateOnly = new Date(Date.UTC(istParts(now).year, istParts(now).month, istParts(now).day))
  const [branches, athletes, memberships, payments, dues, checkIns, inside, risks] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true, hourlyCapacity: true } }),
    db.athlete.findMany({ where: { archived: false }, select: { id: true, homeBranchId: true } }),
    db.membership.findMany({ where: { status: 'ACTIVE', endsAt: { gte: todayDateOnly } }, select: { athleteId: true } }),
    db.payment.findMany({ where: { status: 'PAID', paidAt: { gte: monthStart } }, select: { athleteId: true, amountPaise: true } }),
    db.due.findMany({ where: { status: 'OPEN' }, select: { athleteId: true, amountPaise: true } }),
    db.checkIn.groupBy({ by: ['branchId'], where: { checkedInAt: { gte: todayStart } }, _count: { _all: true } }),
    db.checkIn.groupBy({ by: ['branchId'], where: { checkedOutAt: null, checkedInAt: { gte: new Date(now.getTime() - sessionMinutes * 60 * 1000) } }, _count: { _all: true } }),
    db.riskScore.findMany({ where: { weekOf: mondayOf(todayDateOnly), score: { gte: RISK_THRESHOLD }, contacted: false }, select: { athleteId: true } }),
  ])
  const home = new Map(athletes.map((athlete) => [athlete.id, athlete.homeBranchId]))
  const sumBy = (rows: { athleteId: string; amountPaise?: number }[], branchId: string, money: boolean) =>
    rows.reduce((total, row) => (home.get(row.athleteId) === branchId ? total + (money ? (row.amountPaise ?? 0) : 1) : total), 0)
  return branches.map((branch) => {
    const insideNow = inside.find((row) => row.branchId === branch.id)?._count._all ?? 0
    return {
      id: branch.id,
      name: branch.name,
      activeMembers: new Set(memberships.filter((row) => home.get(row.athleteId) === branch.id).map((row) => row.athleteId)).size,
      todayCheckIns: checkIns.find((row) => row.branchId === branch.id)?._count._all ?? 0,
      inside: insideNow,
      capacity: branch.hourlyCapacity,
      percent: branch.hourlyCapacity ? Math.min(100, Math.round((insideNow / branch.hourlyCapacity) * 100)) : 0,
      collectedThisMonthPaise: sumBy(payments, branch.id, true),
      pendingDuesPaise: sumBy(dues, branch.id, true),
      atRisk: sumBy(risks, branch.id, false),
    }
  })
}
