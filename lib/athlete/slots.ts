import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { addDays, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'

// Slot booking for members.
//  - next 7 days, home branch (any branch when the plan allows cross-branch)
//  - capacity is enforced in the database: booked is only incremented while
//    booked < capacity, so two people can never take the last spot
//  - one booking per member per day; "move" swaps it in one transaction
//  - cancel any time before the slot starts; the spot goes back to the pool

export const BOOKING_DAYS = 7

export interface SlotView {
  id: string
  branchId: string
  date: string
  startHour: number
  capacity: number
  booked: number
  left: number
  past: boolean
  mine: boolean
  bookingId: string | null
}

export function slotStart(date: Date, hour: number): Date {
  return new Date(date.getTime() + hour * 3600000 - IST_OFFSET_MS)
}

export async function bookableBranchIds(db: TenantDb, athlete: { id: string; homeBranchId: string }, crossBranchFeature: boolean): Promise<string[]> {
  if (!crossBranchFeature) return [athlete.homeBranchId]
  const today = istDateOnly()
  const membership = await db.membership.findFirst({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'PENDING'] }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' } })
  const plan = membership ? await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { crossBranch: true } }) : null
  if (!plan?.crossBranch) return [athlete.homeBranchId]
  const branches = await db.branch.findMany({ where: { archived: false }, select: { id: true } })
  return branches.map((branch) => branch.id)
}

export async function listSlots(db: TenantDb, athleteId: string, branchId: string, date: Date, now: Date = new Date()): Promise<SlotView[]> {
  const [slots, mine] = await Promise.all([
    db.slot.findMany({ where: { branchId, date }, orderBy: { startHour: 'asc' } }),
    db.slotBooking.findMany({ where: { athleteId, status: 'BOOKED' }, select: { id: true, slotId: true } }),
  ])
  const mineBySlot = new Map(mine.map((booking) => [booking.slotId, booking.id]))
  return slots.map((slot) => ({
    id: slot.id,
    branchId: slot.branchId,
    date: slot.date.toISOString().slice(0, 10),
    startHour: slot.startHour,
    capacity: slot.capacity,
    booked: slot.booked,
    left: Math.max(0, slot.capacity - slot.booked),
    past: slotStart(slot.date, slot.startHour).getTime() <= now.getTime(),
    mine: mineBySlot.has(slot.id),
    bookingId: mineBySlot.get(slot.id) ?? null,
  }))
}

export async function myBookings(db: TenantDb, athleteId: string, now: Date = new Date()) {
  const today = istDateOnly(now)
  const bookings = await db.slotBooking.findMany({ where: { athleteId, status: 'BOOKED' } })
  if (bookings.length === 0) return []
  const slots = await db.slot.findMany({ where: { id: { in: bookings.map((b) => b.slotId) }, date: { gte: today } }, include: { branch: { select: { name: true } } } })
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  return bookings
    .map((booking) => ({ booking, slot: slotById.get(booking.slotId) }))
    .filter((row): row is { booking: (typeof bookings)[number]; slot: (typeof slots)[number] } => Boolean(row.slot) && slotStart(row.slot!.date, row.slot!.startHour).getTime() > now.getTime())
    .sort((a, b) => a.slot.date.getTime() - b.slot.date.getTime() || a.slot.startHour - b.slot.startHour)
    .map(({ booking, slot }) => ({ id: booking.id, slotId: slot.id, date: slot.date.toISOString().slice(0, 10), startHour: slot.startHour, branch: slot.branch.name }))
}

export async function bookSlot(db: TenantDb, gymId: string, athlete: { id: string }, slotId: string, allowedBranchIds: string[], options: { replaceBookingId?: string } = {}, now: Date = new Date()) {
  return db.$transaction(async (tx) => {
    const slot = await tx.slot.findFirst({ where: { id: slotId } })
    if (!slot || !allowedBranchIds.includes(slot.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Slot not found')
    const today = istDateOnly(now)
    if (slot.date.getTime() > addDays(today, BOOKING_DAYS - 1).getTime()) throw new ApiError(422, 'VALIDATION_ERROR', `Slots open ${BOOKING_DAYS} days ahead`)
    if (slotStart(slot.date, slot.startHour).getTime() <= now.getTime()) throw new ApiError(422, 'VALIDATION_ERROR', 'This slot has already started')

    const membership = await tx.membership.findFirst({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'PENDING'] }, startsAt: { lte: slot.date }, endsAt: { gte: slot.date } } })
    if (!membership) throw new ApiError(422, 'VALIDATION_ERROR', 'Your plan does not cover this day. Renew in Pay to book.')

    // Moving: release the old booking first (same transaction).
    if (options.replaceBookingId) {
      const old = await tx.slotBooking.findFirst({ where: { id: options.replaceBookingId, athleteId: athlete.id, status: 'BOOKED' } })
      if (!old) throw new ApiError(404, 'NOT_FOUND', 'Booking not found')
      if (old.slotId === slot.id) throw new ApiError(409, 'CONFLICT', 'You already have this slot')
      await tx.slotBooking.update({ where: { id: old.id }, data: { status: 'CANCELLED' } })
      await tx.slot.updateMany({ where: { id: old.slotId, booked: { gt: 0 } }, data: { booked: { decrement: 1 } } })
    }

    // One booking per day.
    const sameDay = await tx.slot.findMany({ where: { date: slot.date }, select: { id: true } })
    const clash = await tx.slotBooking.findFirst({ where: { athleteId: athlete.id, status: 'BOOKED', slotId: { in: sameDay.map((s) => s.id) } } })
    if (clash) throw new ApiError(409, 'CONFLICT', clash.slotId === slot.id ? 'You already have this slot' : 'You already have a slot that day. Move it instead.')

    const taken = await tx.slot.updateMany({ where: { id: slot.id, booked: { lt: slot.capacity } }, data: { booked: { increment: 1 } } })
    if (taken.count === 0) throw new ApiError(409, 'CONFLICT', 'This slot just filled up. Pick another time.')

    const existing = await tx.slotBooking.findFirst({ where: { slotId: slot.id, athleteId: athlete.id } })
    const booking = existing
      ? await tx.slotBooking.update({ where: { id: existing.id }, data: { status: 'BOOKED', remindedAt: null } })
      : await tx.slotBooking.create({ data: { gymId, slotId: slot.id, athleteId: athlete.id } })
    return { id: booking.id, slotId: slot.id, date: slot.date.toISOString().slice(0, 10), startHour: slot.startHour }
  })
}

export async function cancelBooking(db: TenantDb, athleteId: string, bookingId: string, now: Date = new Date()) {
  return db.$transaction(async (tx) => {
    const booking = await tx.slotBooking.findFirst({ where: { id: bookingId, athleteId, status: 'BOOKED' } })
    if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found')
    const slot = await tx.slot.findFirst({ where: { id: booking.slotId } })
    if (slot && slotStart(slot.date, slot.startHour).getTime() <= now.getTime()) throw new ApiError(422, 'VALIDATION_ERROR', 'This slot has already started')
    await tx.slotBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })
    await tx.slot.updateMany({ where: { id: booking.slotId, booked: { gt: 0 } }, data: { booked: { decrement: 1 } } })
    return { ok: true }
  })
}

// The week strip on the schedule screen: today + 6 days (IST).
export function weekDates(now: Date = new Date()): Date[] {
  const today = istDateOnly(now)
  return Array.from({ length: BOOKING_DAYS }, (_, i) => addDays(today, i))
}

export function weekdayOf(date: Date): number {
  return date.getUTCDay()
}

export function nowHourIst(now: Date = new Date()): number {
  return istParts(now).hour
}
