import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { parseGymSettings } from '@/lib/gym/settings'
import { addDays, istDateOnly, istParts, istStartOfDay } from '@/lib/time'
import { computeAttendanceStatus, computeStreak } from './status'

// The one place a check-in is recorded, whatever the method:
// desk QR scan, self check-in, biometric punch, manual desk entry or the
// paper register. Rules:
//   - member must be active (not archived)
//   - must have a running plan (not expired / frozen) unless the method
//     allows it (manual register, biometric device that already opened the door)
//   - home branch, or any branch when the plan allows cross-branch access
//   - an open visit within the session window is returned, not duplicated
// After recording: last visit, streak, attendance status and slot booking
// are updated immediately.

export type CheckInMethod = 'QR_ROTATING' | 'QR_ENTRANCE' | 'GEO_SELF' | 'MANUAL' | 'REGISTER' | 'BIOMETRIC'

export interface CheckInInput {
  athleteId: string
  branchId: string
  method: CheckInMethod
  at?: Date
  recordedById?: string | null
  deviceId?: string | null
  externalRef?: string | null
  allowWithoutPlan?: boolean
  crossBranchFeature?: boolean
}

export interface CheckInSummary {
  status: 'checked_in' | 'already_inside' | 'duplicate'
  checkInId: string
  checkedInAt: Date
  warnings: string[]
  athlete: { id: string; name: string; memberCode: string; streakDays: number; planName: string | null; daysLeft: number | null; duePaise: number }
}

const DAY_MS = 86400000

function dayKey(date: Date): string {
  return istDateOnly(date).toISOString().slice(0, 10)
}

export function blocked(message: string): ApiError {
  return new ApiError(422, 'CHECKIN_BLOCKED', message)
}

export async function recordCheckIn(db: TenantDb, gym: { id: string; sessionMinutes: number; settings: unknown }, input: CheckInInput): Promise<CheckInSummary> {
  const at = input.at ?? new Date()
  const today = istDateOnly(at)
  const athlete = await db.athlete.findFirst({ where: { id: input.athleteId } })
  if (!athlete || athlete.archived) throw blocked('Member not found or archived')
  const branch = await db.branch.findFirst({ where: { id: input.branchId, archived: false } })
  if (!branch) throw blocked('Unknown branch')

  if (input.externalRef) {
    const existing = await db.checkIn.findFirst({ where: { externalRef: input.externalRef } })
    if (existing) return summary(db, athlete.id, existing.id, existing.checkedInAt, 'duplicate', [])
  }

  const warnings: string[] = []
  const memberships = await db.membership.findMany({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'PENDING', 'FROZEN'] }, startsAt: { lte: today }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' } })
  const running = memberships.find((m) => !(m.frozenFrom && m.frozenUntil && m.frozenFrom <= today && m.frozenUntil >= today))
  const frozen = memberships.length > 0 && !running
  if (!running) {
    const message = frozen ? 'Plan is frozen today. Unfreeze it at the desk to train.' : 'No running plan. Please renew at the desk.'
    if (!input.allowWithoutPlan) throw blocked(message)
    warnings.push(message)
  }

  if (branch.id !== athlete.homeBranchId) {
    const plan = running ? await db.membershipPlan.findFirst({ where: { id: running.planId }, select: { crossBranch: true } }) : null
    const allowed = Boolean(plan?.crossBranch && input.crossBranchFeature)
    if (!allowed) {
      if (!input.allowWithoutPlan) throw blocked(`This plan is for the home branch only. Check in at your home branch.`)
      warnings.push('Visiting from another branch')
    }
  }

  // Already inside? (open visit within the session window)
  const windowStart = new Date(at.getTime() - gym.sessionMinutes * 60000)
  const open = await db.checkIn.findFirst({ where: { athleteId: athlete.id, checkedOutAt: null, checkedInAt: { gte: windowStart, lte: new Date(at.getTime() + 60000) } }, orderBy: { checkedInAt: 'desc' } })
  if (open) return summary(db, athlete.id, open.id, open.checkedInAt, 'already_inside', warnings)

  // Backdated entries (register, device sync): one per member per hour.
  if (input.at) {
    const hourStart = new Date(Math.floor(at.getTime() / 3600000) * 3600000)
    const same = await db.checkIn.findFirst({ where: { athleteId: athlete.id, checkedInAt: { gte: hourStart, lt: new Date(hourStart.getTime() + 3600000) } } })
    if (same) return summary(db, athlete.id, same.id, same.checkedInAt, 'duplicate', warnings)
  }

  const checkIn = await db.checkIn.create({
    data: {
      gymId: gym.id,
      branchId: branch.id,
      athleteId: athlete.id,
      method: input.method,
      checkedInAt: at,
      recordedById: input.recordedById ?? null,
      deviceId: input.deviceId ?? null,
      externalRef: input.externalRef ?? null,
    },
  })

  await refreshAthleteAttendance(db, gym, athlete.id, at)

  // Mark a matching slot booking (same day, booked hour or the one before) as attended.
  const hour = istParts(at).hour
  const slots = await db.slot.findMany({ where: { branchId: branch.id, date: today, startHour: { in: [hour, hour - 1] } }, select: { id: true } })
  if (slots.length) await db.slotBooking.updateMany({ where: { athleteId: athlete.id, slotId: { in: slots.map((slot) => slot.id) }, status: 'BOOKED' }, data: { status: 'ATTENDED' } })

  return summary(db, athlete.id, checkIn.id, checkIn.checkedInAt, 'checked_in', warnings)
}

// Recomputes last visit, streak, best streak and status from real data.
export async function refreshAthleteAttendance(db: TenantDb, gym: { id: string; settings: unknown }, athleteId: string, now: Date = new Date()) {
  const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true, joinedAt: true, restDays: true, bestStreak: true, homeBranchId: true } })
  if (!athlete) return
  const since = addDays(istStartOfDay(now), -120)
  const [visits, branch, membership] = await Promise.all([
    db.checkIn.findMany({ where: { athleteId, checkedInAt: { gte: since, lte: new Date(now.getTime() + 60000) } }, select: { checkedInAt: true }, orderBy: { checkedInAt: 'asc' } }),
    db.branch.findFirst({ where: { id: athlete.homeBranchId }, select: { holidays: true } }),
    db.membership.findMany({ where: { athleteId, startsAt: { lte: istDateOnly(now) }, endsAt: { gte: istDateOnly(now) }, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] } } }),
  ])
  const settings = parseGymSettings(gym.settings)
  const today = istDateOnly(now)
  const frozen = membership.length > 0 && membership.every((m) => m.frozenFrom && m.frozenUntil && m.frozenFrom <= today && m.frozenUntil >= today)
  const keys = new Set(visits.map((visit) => dayKey(visit.checkedInAt)))
  const holidays = new Set((branch?.holidays ?? []).map((day) => day.toISOString().slice(0, 10)))
  const streak = computeStreak(keys, now, athlete.restDays, holidays, dayKey, (date) => istParts(date).weekday)
  const last = visits.at(-1)?.checkedInAt ?? null
  const status = computeAttendanceStatus(
    { now, joinedAt: athlete.joinedAt, lastVisitAt: last, visitsLast14Days: visits.filter((visit) => visit.checkedInAt.getTime() >= now.getTime() - 14 * DAY_MS).length, hasActiveMembership: membership.length > 0, isFrozen: frozen },
    settings.thresholds,
  )
  await db.athlete.update({
    where: { id: athleteId },
    data: { lastVisitAt: last, streakDays: streak, bestStreak: Math.max(athlete.bestStreak, streak), status, statusComputedAt: new Date() },
  })
}

async function summary(db: TenantDb, athleteId: string, checkInId: string, checkedInAt: Date, status: CheckInSummary['status'], warnings: string[]): Promise<CheckInSummary> {
  const today = istDateOnly()
  const [athlete, membership, dues] = await Promise.all([
    db.athlete.findFirstOrThrow({ where: { id: athleteId }, select: { id: true, name: true, memberCode: true, streakDays: true } }),
    db.membership.findFirst({ where: { athleteId, endsAt: { gte: today }, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] } }, orderBy: { endsAt: 'desc' } }),
    db.due.aggregate({ where: { athleteId, status: 'OPEN' }, _sum: { amountPaise: true } }),
  ])
  const plan = membership ? await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { name: true } }) : null
  const duePaise = dues._sum.amountPaise ?? 0
  if (duePaise > 0 && !warnings.some((w) => w.startsWith('Due'))) warnings.push('Has pending dues')
  return {
    status,
    checkInId,
    checkedInAt,
    warnings,
    athlete: { ...athlete, planName: plan?.name ?? null, daysLeft: membership ? Math.round((membership.endsAt.getTime() - today.getTime()) / DAY_MS) : null, duePaise },
  }
}

export async function checkOut(db: TenantDb, checkInId: string, at: Date = new Date()) {
  const checkIn = await db.checkIn.findFirst({ where: { id: checkInId } })
  if (!checkIn) throw new ApiError(404, 'NOT_FOUND', 'Check-in not found')
  if (checkIn.checkedOutAt) return checkIn
  return db.checkIn.update({ where: { id: checkIn.id }, data: { checkedOutAt: at.getTime() < checkIn.checkedInAt.getTime() ? checkIn.checkedInAt : at } })
}

// Device "OUT" punch: closes today's open visit of that member.
export async function checkOutOpenVisit(db: TenantDb, athleteId: string, at: Date): Promise<boolean> {
  const open = await db.checkIn.findFirst({ where: { athleteId, checkedOutAt: null, checkedInAt: { gte: istStartOfDay(at), lte: at } }, orderBy: { checkedInAt: 'desc' } })
  if (!open) return false
  await db.checkIn.update({ where: { id: open.id }, data: { checkedOutAt: at } })
  return true
}
