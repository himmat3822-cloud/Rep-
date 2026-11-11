import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { appUrl } from '@/lib/env'
import { addDays, formatHour, formatIstDate, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'
import type { MessagingSettings } from '@/lib/gym/settings'
import { firstName, waText } from './templates'
import { QUIET_END_HOUR, QUIET_START_HOUR, isQuietHour } from './policy'
import { sendGymMessage, type MessagingContext, type SendOutcome } from './send'

// Renewal reminders, slot reminders, birthday / anniversary wishes and the
// weekly report card. Each one is idempotent through its dedupe key.

const DAY_MS = 86400000

export interface ScheduledGym {
  id: string
  name: string
  slug: string
  messaging: MessagingSettings
}

export interface JobCount {
  sent: number
  skipped: number
  blocked: number
  failed: number
  stoppedBy?: SendOutcome
}

const emptyCount = (): JobCount => ({ sent: 0, skipped: 0, blocked: 0, failed: 0 })

function tally(count: JobCount, outcome: SendOutcome): boolean {
  if (outcome === 'sent') count.sent += 1
  else if (outcome === 'quota') count.blocked += 1
  else if (outcome === 'failed') count.failed += 1
  else count.skipped += 1
  if (outcome === 'quiet_hours' || outcome === 'paused') {
    count.stoppedBy = outcome
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Plan ending soon (default 7 days and 1 day before), skipped once renewed.
// ---------------------------------------------------------------------------
export async function runRenewalReminders(base: PrismaClient, ctx: MessagingContext, gym: ScheduledGym, now: Date = new Date()): Promise<JobCount> {
  const db = scopeToGym(base, gym.id)
  const count = emptyCount()
  const today = istDateOnly(now)
  const days = [...new Set(gym.messaging.renewalDays)]
  if (days.length === 0) return count

  const memberships = await db.membership.findMany({ where: { status: 'ACTIVE', endsAt: { in: days.map((d) => addDays(today, d)) } } })
  if (memberships.length === 0) return count
  const athleteIds = [...new Set(memberships.map((m) => m.athleteId))]
  const [athletes, later, plans] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: athleteIds }, archived: false }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true } }),
    db.membership.findMany({ where: { athleteId: { in: athleteIds }, status: { in: ['ACTIVE', 'PENDING'] } }, select: { athleteId: true, endsAt: true } }),
    db.membershipPlan.findMany({ where: { id: { in: [...new Set(memberships.map((m) => m.planId))] } }, select: { id: true, name: true } }),
  ])
  const athleteById = new Map(athletes.map((a) => [a.id, a]))
  const planById = new Map(plans.map((p) => [p.id, p.name]))

  for (const membership of memberships) {
    const athlete = athleteById.get(membership.athleteId)
    if (!athlete) continue
    const renewed = later.some((other) => other.athleteId === membership.athleteId && other.endsAt.getTime() > membership.endsAt.getTime())
    if (renewed) continue
    const daysLeft = Math.round((membership.endsAt.getTime() - today.getTime()) / DAY_MS)
    const result = await sendGymMessage(
      base,
      ctx,
      {
        template: 'kasrat_renewal_reminder',
        language: athlete.language,
        params: [firstName(athlete.name), gym.name, planById.get(membership.planId) ?? 'membership', formatIstDate(membership.endsAt, { day: 'numeric', month: 'short' }), String(daysLeft), `${appUrl()}/g/${gym.slug}`],
        to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
        purpose: 'renewal',
        pushFirst: { title: gym.name, path: '/pay' },
        dedupeKey: `renew:${membership.id}:${daysLeft}`,
      },
      now,
    )
    if (!tally(count, result.outcome)) break
  }
  return count
}

// ---------------------------------------------------------------------------
// Slot reminders: about 1 hour before. Slots that start before 9 AM would
// need a message inside quiet hours, so those are sent the evening before
// (between 7 and 9 PM).
// ---------------------------------------------------------------------------
export function slotTargets(now: Date): { date: Date; hours: number[]; tomorrow: boolean }[] {
  if (isQuietHour(now)) return []
  const { hour } = istParts(now)
  const today = istDateOnly(now)
  const targets: { date: Date; hours: number[]; tomorrow: boolean }[] = []
  const next = hour + 1
  if (next > QUIET_END_HOUR && next < 24) targets.push({ date: today, hours: [next], tomorrow: false })
  if (hour >= 19 && hour < QUIET_START_HOUR) {
    targets.push({ date: addDays(today, 1), hours: Array.from({ length: QUIET_END_HOUR + 1 }, (_, h) => h), tomorrow: true })
  }
  return targets
}

export async function runSlotReminders(base: PrismaClient, ctx: MessagingContext, gym: ScheduledGym, now: Date = new Date()): Promise<JobCount> {
  const db = scopeToGym(base, gym.id)
  const count = emptyCount()
  for (const target of slotTargets(now)) {
    const slots = await db.slot.findMany({ where: { date: target.date, startHour: { in: target.hours } }, include: { branch: { select: { name: true } } } })
    if (slots.length === 0) continue
    const branchCount = await db.branch.count({ where: { archived: false } })
    const slotById = new Map(slots.map((slot) => [slot.id, slot]))
    const bookings = await db.slotBooking.findMany({ where: { slotId: { in: slots.map((s) => s.id) }, status: 'BOOKED', remindedAt: null } })
    if (bookings.length === 0) continue
    const athletes = await db.athlete.findMany({ where: { id: { in: bookings.map((b) => b.athleteId) }, archived: false }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true } })
    const athleteById = new Map(athletes.map((a) => [a.id, a]))

    for (const booking of bookings) {
      const athlete = athleteById.get(booking.athleteId)
      const slot = slotById.get(booking.slotId)
      if (!athlete || !slot) continue
      const when = waText(athlete.language, target.tomorrow ? 'tomorrowAt' : 'todayAt', { time: formatHour(slot.startHour) })
      const place = branchCount > 1 ? `${gym.name}, ${slot.branch.name}` : gym.name
      const result = await sendGymMessage(
        base,
        ctx,
        {
          template: 'kasrat_slot_reminder',
          language: athlete.language,
          params: [firstName(athlete.name), when, place],
          to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
          purpose: 'slot_reminder',
          pushFirst: { title: gym.name, path: '/schedule' },
          dedupeKey: `slot:${booking.id}`,
        },
        now,
      )
      if (result.outcome === 'sent' || result.outcome === 'duplicate' || result.outcome === 'opted_out') {
        await db.slotBooking.update({ where: { id: booking.id }, data: { remindedAt: now } })
      }
      if (!tally(count, result.outcome)) return count
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Birthdays (all current members) and joining anniversaries (members with a
// running plan). Feb 29 birthdays are wished on Feb 28 in other years.
// ---------------------------------------------------------------------------
export function isSameDayOfYear(date: Date, today: { year: number; month: number; day: number }): boolean {
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (month === today.month && day === today.day) return true
  const leap = (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0
  return !leap && month === 1 && day === 29 && today.month === 1 && today.day === 28
}

// joinedAt is a timestamp, so shift it to the IST calendar date first.
function istCalendar(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS)
}

export async function runWishes(base: PrismaClient, ctx: MessagingContext, gym: ScheduledGym, now: Date = new Date()): Promise<{ birthdays: JobCount; anniversaries: JobCount }> {
  const db = scopeToGym(base, gym.id)
  const birthdays = emptyCount()
  const anniversaries = emptyCount()
  const today = istParts(now)
  const todayDate = istDateOnly(now)

  if (gym.messaging.birthdayWishes) {
    const people = await db.athlete.findMany({ where: { archived: false, dateOfBirth: { not: null } }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true, dateOfBirth: true } })
    for (const person of people) {
      if (!person.dateOfBirth || !isSameDayOfYear(person.dateOfBirth, today)) continue
      const result = await sendGymMessage(
        base,
        ctx,
        {
          template: 'kasrat_birthday',
          language: person.language,
          params: [firstName(person.name), gym.name],
          to: { phone: person.phone, athleteId: person.id, optedOut: person.whatsappOptOut },
          purpose: 'birthday',
          pushFirst: { title: gym.name, path: '' },
          dedupeKey: `bday:${person.id}:${today.year}`,
        },
        now,
      )
      if (!tally(birthdays, result.outcome)) break
    }
  }

  if (gym.messaging.anniversaryWishes) {
    const running = await db.membership.findMany({ where: { status: 'ACTIVE', startsAt: { lte: todayDate }, endsAt: { gte: todayDate } }, select: { athleteId: true } })
    const ids = [...new Set(running.map((m) => m.athleteId))]
    if (ids.length) {
      const people = await db.athlete.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true, joinedAt: true } })
      const due = people.filter((person) => {
        const joined = istCalendar(person.joinedAt)
        return joined.getUTCFullYear() < today.year && isSameDayOfYear(joined, today)
      })
      const visits = due.length ? await db.checkIn.groupBy({ by: ['athleteId'], where: { athleteId: { in: due.map((p) => p.id) } }, _count: { _all: true } }) : []
      const visitsBy = new Map(visits.map((row) => [row.athleteId, row._count._all]))
      for (const person of due) {
        const years = today.year - istCalendar(person.joinedAt).getUTCFullYear()
        const result = await sendGymMessage(
          base,
          ctx,
          {
            template: 'kasrat_anniversary',
            language: person.language,
            params: [firstName(person.name), String(years), gym.name, String(visitsBy.get(person.id) ?? 0)],
            to: { phone: person.phone, athleteId: person.id, optedOut: person.whatsappOptOut },
            purpose: 'anniversary',
            pushFirst: { title: gym.name, path: '/progress' },
            dedupeKey: `anniv:${person.id}:${today.year}`,
          },
          now,
        )
        if (!tally(anniversaries, result.outcome)) break
      }
    }
  }
  return { birthdays, anniversaries }
}

// ---------------------------------------------------------------------------
// Weekly report card: Sunday from 6 PM (or Monday morning on a daily cron)
// for the Monday-Sunday week that just ended.
// ---------------------------------------------------------------------------
export function reportWeekFor(now: Date): Date | null {
  if (isQuietHour(now)) return null
  const { weekday, hour } = istParts(now)
  const today = istDateOnly(now)
  if (weekday === 0 && hour >= 18) return addDays(today, -6)
  if (weekday === 1 && hour < 18) return addDays(today, -7)
  return null
}

export function favouriteHour(hours: number[]): number | null {
  if (hours.length === 0) return null
  const counts = new Map<number, number>()
  for (const hour of hours) counts.set(hour, (counts.get(hour) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
}

export function progressLine(lang: 'EN' | 'HI' | 'PA', firstWeight: number | null, lastWeight: number | null): string {
  if (firstWeight === null || lastWeight === null) return waText(lang, 'progressNone')
  const change = Math.round((lastWeight - firstWeight) * 10) / 10
  if (change === 0) return waText(lang, 'progressSteady')
  return waText(lang, 'progressWeight', { change: `${change > 0 ? '+' : ''}${change}` })
}

export async function runWeeklyReports(base: PrismaClient, ctx: MessagingContext, gym: ScheduledGym, weekStart: Date, now: Date = new Date()): Promise<JobCount> {
  const db = scopeToGym(base, gym.id)
  const count = emptyCount()
  const weekEnd = addDays(weekStart, 7)
  const lastDay = addDays(weekStart, 6)
  const running = await db.membership.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRED'] }, startsAt: { lte: lastDay }, endsAt: { gte: lastDay } }, select: { athleteId: true } })
  const ids = [...new Set(running.map((m) => m.athleteId))]
  if (ids.length === 0) return count

  // Check-in timestamps: the week is in IST, so move the window by the IST offset.
  const rangeStart = new Date(weekStart.getTime() - IST_OFFSET_MS)
  const rangeEnd = new Date(weekEnd.getTime() - IST_OFFSET_MS)
  const [people, weekVisits, recentVisits, logs] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true, streakDays: true } }),
    db.checkIn.findMany({ where: { athleteId: { in: ids }, checkedInAt: { gte: rangeStart, lt: rangeEnd } }, select: { athleteId: true, checkedInAt: true } }),
    db.checkIn.findMany({ where: { athleteId: { in: ids }, checkedInAt: { gte: addDays(rangeEnd, -28), lt: rangeEnd } }, select: { athleteId: true, checkedInAt: true } }),
    db.progressLog.findMany({ where: { athleteId: { in: ids }, loggedOn: { gte: addDays(lastDay, -28), lte: lastDay }, weightKg: { not: null } }, orderBy: { loggedOn: 'asc' }, select: { athleteId: true, weightKg: true } }),
  ])

  const daysBy = new Map<string, Set<string>>()
  for (const visit of weekVisits) {
    const key = istDateOnly(visit.checkedInAt).toISOString().slice(0, 10)
    const set = daysBy.get(visit.athleteId) ?? new Set<string>()
    set.add(key)
    daysBy.set(visit.athleteId, set)
  }
  const hoursBy = new Map<string, number[]>()
  for (const visit of recentVisits) {
    const list = hoursBy.get(visit.athleteId) ?? []
    list.push(istParts(visit.checkedInAt).hour)
    hoursBy.set(visit.athleteId, list)
  }
  const weightsBy = new Map<string, number[]>()
  for (const log of logs) {
    const list = weightsBy.get(log.athleteId) ?? []
    if (log.weightKg !== null) list.push(log.weightKg)
    weightsBy.set(log.athleteId, list)
  }
  const weekKey = weekStart.toISOString().slice(0, 10)

  for (const person of people) {
    const hour = favouriteHour(hoursBy.get(person.id) ?? [])
    const weights = weightsBy.get(person.id) ?? []
    const result = await sendGymMessage(
      base,
      ctx,
      {
        template: 'kasrat_weekly_report',
        language: person.language,
        params: [
          firstName(person.name),
          String(daysBy.get(person.id)?.size ?? 0),
          String(person.streakDays),
          hour === null ? waText(person.language, 'noFavourite') : formatHour(hour),
          progressLine(person.language, weights.length > 1 ? weights[0] : null, weights.length > 1 ? weights[weights.length - 1] : null),
          gym.name,
        ],
        to: { phone: person.phone, athleteId: person.id, optedOut: person.whatsappOptOut },
        purpose: 'weekly_report',
        pushFirst: { title: gym.name, path: '/progress' },
        dedupeKey: `weekly:${person.id}:${weekKey}`,
      },
      now,
    )
    if (!tally(count, result.outcome)) break
  }
  return count
}
