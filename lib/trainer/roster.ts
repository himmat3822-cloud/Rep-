import type { TenantDb } from '@/lib/db/tenant-core'
import { daysBetween, istDateOnly, istStartOfDay } from '@/lib/time'
import { rosterWhere } from './service'

// Roster rows for the trainer desk. Deliberately no money fields.

export interface RosterRow {
  id: string
  name: string
  memberCode: string
  status: string
  lastVisitAt: Date | null
  idleDays: number | null
  streakDays: number
  daysLeft: number | null
  inToday: boolean
  slotToday: number | null
  hasPlan: boolean
  pendingPt: number
  ptLeft: number
}

export async function loadRoster(db: TenantDb, staff: { sub: string; kind: string; name: string }, now: Date = new Date()): Promise<RosterRow[]> {
  const athletes = await db.athlete.findMany({ where: rosterWhere(staff as never), orderBy: { name: 'asc' }, select: { id: true, name: true, memberCode: true, status: true, lastVisitAt: true, streakDays: true } })
  if (athletes.length === 0) return []
  const ids = athletes.map((a) => a.id)
  const today = istDateOnly(now)
  const [memberships, visits, slots, splits, pt] = await Promise.all([
    db.membership.findMany({ where: { athleteId: { in: ids }, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] }, endsAt: { gte: today } }, select: { athleteId: true, endsAt: true, ptSessionsLeft: true } }),
    db.checkIn.findMany({ where: { athleteId: { in: ids }, checkedInAt: { gte: istStartOfDay(now) } }, select: { athleteId: true } }),
    db.slot.findMany({ where: { date: today }, select: { id: true, startHour: true } }),
    db.workoutSplit.findMany({ where: { athleteId: { in: ids }, active: true }, select: { athleteId: true } }),
    db.ptSession.groupBy({ by: ['athleteId'], where: { athleteId: { in: ids }, athleteSignedAt: null, athleteDisputedAt: null }, _count: { _all: true } }),
  ])
  const bookings = slots.length ? await db.slotBooking.findMany({ where: { athleteId: { in: ids }, status: 'BOOKED', slotId: { in: slots.map((s) => s.id) } }, select: { athleteId: true, slotId: true } }) : []
  const slotHour = new Map(slots.map((s) => [s.id, s.startHour]))
  const endBy = new Map<string, Date>()
  for (const m of memberships) if (!endBy.has(m.athleteId) || m.endsAt > endBy.get(m.athleteId)!) endBy.set(m.athleteId, m.endsAt)
  const ptLeftBy = new Map<string, number>()
  for (const m of memberships) ptLeftBy.set(m.athleteId, (ptLeftBy.get(m.athleteId) ?? 0) + m.ptSessionsLeft)
  const inToday = new Set(visits.map((v) => v.athleteId))
  const slotBy = new Map(bookings.map((b) => [b.athleteId, slotHour.get(b.slotId) ?? null]))
  const planned = new Set(splits.map((s) => s.athleteId))
  const ptBy = new Map(pt.map((row) => [row.athleteId, row._count._all]))
  return athletes.map((a) => ({
    id: a.id,
    name: a.name,
    memberCode: a.memberCode,
    status: a.status,
    lastVisitAt: a.lastVisitAt,
    idleDays: a.lastVisitAt ? daysBetween(istDateOnly(a.lastVisitAt), today) : null,
    streakDays: a.streakDays,
    daysLeft: endBy.has(a.id) ? daysBetween(today, endBy.get(a.id)!) : null,
    inToday: inToday.has(a.id),
    slotToday: slotBy.get(a.id) ?? null,
    hasPlan: planned.has(a.id),
    pendingPt: ptBy.get(a.id) ?? 0,
    ptLeft: ptLeftBy.get(a.id) ?? 0,
  }))
}
