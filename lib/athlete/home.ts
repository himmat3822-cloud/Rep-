import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { fallbackMotivation, type Lang } from '@/lib/i18n'
import { addDays, daysBetween, formatHour, istDateOnly, istParts, istStartOfDay } from '@/lib/time'

export interface WorkoutDay {
  weekday: number
  title: string
  focus: string
  minutes: number
  exercises: { name: string; sets: number; reps: string }[]
}

export interface AthleteHome {
  todayWorkout: WorkoutDay | null
  isRestDay: boolean
  hasSplit: boolean
  crowd: { inside: number; capacity: number; percent: number; bestTime: string | null }
  membership: { planName: string; endsAt: Date; daysLeft: number; active: boolean } | null
  duePaise: number
  challenge: { title: string; description: string; target: number; progress: number } | null
  motivation: string
  announcement: { title: string; body: string } | null
  todaySlot: { startHour: number; time: string } | null
}

export async function getAthleteHome(gymId: string, athlete: { id: string; homeBranchId: string; restDays: number[]; language: Lang }, sessionMinutes: number): Promise<AthleteHome> {
  const db = tenantDb(gymId)
  const now = new Date()
  const today = istDateOnly(now)
  const weekday = istParts(now).weekday
  const todayStart = istStartOfDay(now)

  const [split, inside, branch, membership, dues, challenge, motivation, announcement, history] = await Promise.all([
    db.workoutSplit.findFirst({ where: { athleteId: athlete.id, active: true }, orderBy: { updatedAt: 'desc' } }),
    db.checkIn.count({ where: { branchId: athlete.homeBranchId, checkedOutAt: null, checkedInAt: { gte: new Date(now.getTime() - sessionMinutes * 60000) } } }),
    db.branch.findFirst({ where: { id: athlete.homeBranchId }, select: { hourlyCapacity: true } }),
    db.membership.findFirst({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'FROZEN', 'EXPIRED'] } }, orderBy: { endsAt: 'desc' } }),
    db.due.aggregate({ where: { athleteId: athlete.id, status: 'OPEN' }, _sum: { amountPaise: true } }),
    db.challenge.findFirst({ where: { startsAt: { lte: today }, endsAt: { gte: today } }, orderBy: { startsAt: 'desc' } }),
    db.motivationLine.findFirst({ where: { athleteId: athlete.id, date: today } }),
    db.announcement.findFirst({ where: { AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ branchId: null }, { branchId: athlete.homeBranchId }] }] }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] }),
    db.checkIn.findMany({ where: { branchId: athlete.homeBranchId, checkedInAt: { gte: addDays(todayStart, -28), lt: todayStart } }, select: { checkedInAt: true } }),
  ])

  const days = ((split?.days as { days?: WorkoutDay[] } | null)?.days ?? []) as WorkoutDay[]
  const isRestDay = athlete.restDays.includes(weekday)
  const todayWorkout = isRestDay ? null : (days.find((day) => day.weekday === weekday) ?? null)

  const capacity = branch?.hourlyCapacity ?? 0
  const hourly = new Array<number>(24).fill(0)
  for (const row of history) {
    const parts = istParts(row.checkedInAt)
    if (parts.weekday === weekday) hourly[parts.hour] += 1
  }
  const nowHour = istParts(now).hour
  const upcoming = hourly.map((count, hour) => ({ hour, count })).filter((entry) => entry.hour > nowHour && entry.hour >= 6 && entry.hour <= 21)
  const best = upcoming.length ? upcoming.reduce((a, b) => (b.count < a.count ? b : a)) : null

  const todaySlots = await db.slot.findMany({ where: { date: today }, select: { id: true, startHour: true } })
  const booking = todaySlots.length ? await db.slotBooking.findFirst({ where: { athleteId: athlete.id, status: 'BOOKED', slotId: { in: todaySlots.map((s) => s.id) } } }) : null
  const bookedSlot = booking ? todaySlots.find((s) => s.id === booking.slotId) : null

  const plan = membership ? await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { name: true } }) : null
  const entry = challenge ? await db.challengeEntry.findFirst({ where: { challengeId: challenge.id, athleteId: athlete.id } }) : null

  return {
    todayWorkout,
    isRestDay,
    hasSplit: days.length > 0,
    crowd: { inside, capacity, percent: capacity ? Math.min(100, Math.round((inside / capacity) * 100)) : 0, bestTime: best ? formatHour(best.hour) : null },
    membership: membership
      ? { planName: plan?.name ?? 'Membership', endsAt: membership.endsAt, daysLeft: daysBetween(today, membership.endsAt), active: membership.status === 'ACTIVE' && membership.endsAt >= today }
      : null,
    duePaise: dues._sum.amountPaise ?? 0,
    challenge: challenge ? { title: challenge.title, description: challenge.description, target: challenge.target, progress: entry?.progress ?? 0 } : null,
    motivation: motivation?.text ?? fallbackMotivation(athlete.language, `${athlete.id}:${today.toISOString()}`),
    announcement: announcement ? { title: announcement.title, body: announcement.body } : null,
    todaySlot: bookedSlot ? { startHour: bookedSlot.startHour, time: formatHour(bookedSlot.startHour) } : null,
  }
}
