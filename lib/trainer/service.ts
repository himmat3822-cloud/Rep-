import type { PrismaClient } from '@/lib/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant-core'
import type { StaffClaims } from '@/lib/auth/jwt'
import { ApiError } from '@/lib/api/errors'
import { translate, type Lang } from '@/lib/i18n'
import { notifyAthlete, notifyStaff } from '@/lib/athlete/notify'
import { firstName, nudgeLine, type NudgeKind } from '@/lib/messaging/templates'
import { cleanParam } from '@/lib/messaging/templates'
import { loadMessagingContext, sendGymMessage, type Transport } from '@/lib/messaging/send'
import type { PushTransport } from '@/lib/athlete/push'
import { daysBetween, formatIstDate, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'

// Trainer side of Rep+.
//  - a trainer only ever sees members assigned to them (owners see all)
//  - money (dues, payments) is never part of any trainer view
//  - progress and photos only when the member switched sharing on
//  - PT sessions count for commission only after the member confirms

type Staff = Pick<StaffClaims, 'sub' | 'kind' | 'name'>

export function rosterWhere(staff: Staff) {
  return staff.kind === 'OWNER' ? { archived: false } : { archived: false, trainerId: staff.sub }
}

export async function rosterAthlete(db: TenantDb, staff: Staff, athleteId: string) {
  const athlete = await db.athlete.findFirst({ where: { id: athleteId, ...rosterWhere(staff) } })
  if (!athlete) throw new ApiError(404, 'NOT_FOUND', 'This member is not on your roster')
  return athlete
}

// ---------------------------------------------------------------------------
// Weekly split + diet notes
// ---------------------------------------------------------------------------

export type SplitDay = {
  weekday: number
  title: string
  focus: string
  minutes: number
  exercises: { name: string; sets: number; reps: string }[]
}

export async function assignSplit(db: TenantDb, gym: { id: string; slug: string }, staff: Staff, athleteId: string, input: { days: SplitDay[]; dietNotes: string }, notify = true) {
  const athlete = await rosterAthlete(db, staff, athleteId)
  const days = { days: [...input.days].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)) }
  const split = await db.$transaction(async (tx) => {
    await tx.workoutSplit.updateMany({ where: { athleteId: athlete.id, active: true }, data: { active: false } })
    return tx.workoutSplit.create({ data: { gymId: gym.id, athleteId: athlete.id, createdById: staff.sub, days, dietNotes: input.dietNotes.trim(), active: true } })
  })
  if (notify) {
    const lang = athlete.language as Lang
    await notifyAthlete(db, gym, athlete.id, { title: translate(lang, 'coach', 'notifPlanTitle'), body: translate(lang, 'coach', 'notifPlanBody', { name: firstName(staff.name) }), path: '/schedule', tag: 'plan' })
  }
  return split
}

// Hand the plan back to the member (they can build their own again).
export async function releaseSplit(db: TenantDb, staff: Staff, athleteId: string) {
  const athlete = await rosterAthlete(db, staff, athleteId)
  const result = await db.workoutSplit.updateMany({ where: { athleteId: athlete.id, active: true, createdById: { not: null } }, data: { active: false } })
  return { released: result.count }
}

export async function applyTemplate(db: TenantDb, gym: { id: string; slug: string }, staff: Staff, templateId: string, athleteIds: string[]) {
  const template = await db.workoutTemplate.findFirst({ where: { id: templateId } })
  if (!template) throw new ApiError(404, 'NOT_FOUND', 'Plan template not found')
  const roster = await db.athlete.findMany({ where: { id: { in: athleteIds }, ...rosterWhere(staff) }, select: { id: true } })
  if (roster.length !== new Set(athleteIds).size) throw new ApiError(403, 'FORBIDDEN', 'Some of these members are not on your roster')
  const days = ((template.days as { days?: SplitDay[] } | null)?.days ?? []) as SplitDay[]
  for (const athlete of roster) await assignSplit(db, gym, staff, athlete.id, { days, dietNotes: template.dietNotes })
  return { applied: roster.length }
}

// ---------------------------------------------------------------------------
// Notes (visible to the member)
// ---------------------------------------------------------------------------

export async function addNote(db: TenantDb, gym: { id: string; slug: string }, staff: Staff, athleteId: string, body: string) {
  const athlete = await rosterAthlete(db, staff, athleteId)
  const note = await db.trainerNote.create({ data: { gymId: gym.id, athleteId: athlete.id, trainerId: staff.sub, body: body.trim() } })
  const lang = athlete.language as Lang
  await notifyAthlete(db, gym, athlete.id, { title: translate(lang, 'coach', 'notifNoteTitle', { name: firstName(staff.name) }), body: body.trim().slice(0, 140), path: '', tag: 'trainer-note' })
  return note
}

export async function deleteNote(db: TenantDb, staff: Staff, noteId: string) {
  const where = staff.kind === 'OWNER' ? { id: noteId } : { id: noteId, trainerId: staff.sub }
  const removed = await db.trainerNote.deleteMany({ where })
  if (removed.count === 0) throw new ApiError(404, 'NOT_FOUND', 'Note not found')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Nudges: push first (free), WhatsApp as fallback. One per member per day.
// ---------------------------------------------------------------------------

export async function sendNudge(base: PrismaClient, db: TenantDb, gym: { id: string; name: string }, staff: Staff, athleteId: string, input: { kind: NudgeKind | 'custom'; text?: string }, now: Date = new Date(), transports: { whatsapp?: Transport; push?: PushTransport } = {}) {
  const athlete = await rosterAthlete(db, staff, athleteId)
  const lang = athlete.language as Lang
  const idle = athlete.lastVisitAt ? Math.max(1, daysBetween(istDateOnly(athlete.lastVisitAt), istDateOnly(now))) : 7
  const line = input.kind === 'custom' ? cleanParam(input.text ?? '', 160) : nudgeLine(lang, input.kind, input.kind === 'streak' ? athlete.streakDays : idle)
  if (input.kind === 'custom' && line === '-') throw new ApiError(422, 'VALIDATION_ERROR', 'Write a short message')
  const ctx = await loadMessagingContext(base, gym.id, transports.whatsapp, transports.push)
  const result = await sendGymMessage(
    base,
    ctx,
    {
      template: 'kasrat_trainer_nudge',
      language: lang,
      params: [firstName(athlete.name), firstName(staff.name), line, gym.name],
      to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
      purpose: 'trainer_nudge',
      dedupeKey: `nudge:${athlete.id}:${istDateOnly(now).toISOString().slice(0, 10)}`,
      pushFirst: { title: gym.name, path: '' },
    },
    now,
  )
  switch (result.outcome) {
    case 'sent':
      return { ok: true, line }
    case 'duplicate':
      throw new ApiError(409, 'CONFLICT', 'This member already got a nudge today')
    case 'quiet_hours':
      throw new ApiError(422, 'VALIDATION_ERROR', 'Nudges do not go out between 9 PM and 8 AM')
    case 'opted_out':
      throw new ApiError(422, 'VALIDATION_ERROR', 'This member has no push on and replied STOP to WhatsApp. Talk to them at the gym.')
    case 'quota':
      throw new ApiError(429, 'RATE_LIMITED', 'The gym has used most of its WhatsApp messages this month. Ask them to turn on notifications in the app.')
    case 'paused':
      throw new ApiError(403, 'GYM_READ_ONLY', 'Messages are paused for this gym')
    default:
      throw new ApiError(502, 'DELIVERY_FAILED', result.error ?? 'Could not send the nudge')
  }
}

// ---------------------------------------------------------------------------
// PT sessions
// ---------------------------------------------------------------------------

export function commissionFor(feePaise: number, pct: number): number {
  return Math.round((Math.max(0, feePaise) * Math.min(100, Math.max(0, pct))) / 100)
}

export async function logPtSession(db: TenantDb, gym: { id: string; slug: string }, staff: Staff, input: { athleteId: string; sessionAt: Date; durationMin: number; notes: string }, now: Date = new Date()) {
  const athlete = await rosterAthlete(db, staff, input.athleteId)
  if (input.sessionAt.getTime() > now.getTime() + 15 * 60000) throw new ApiError(422, 'VALIDATION_ERROR', 'Log a session after it happens')
  if (input.sessionAt.getTime() < now.getTime() - 14 * 86400000) throw new ApiError(422, 'VALIDATION_ERROR', 'Sessions older than 14 days cannot be logged')
  const trainer = await db.gymUser.findFirst({ where: { id: staff.sub }, select: { commissionPct: true, ptSessionFeePaise: true, name: true } })
  if (!trainer) throw new ApiError(404, 'NOT_FOUND', 'Trainer not found')
  // Same member, same trainer, within 30 minutes: probably a double tap.
  const clash = await db.ptSession.findFirst({ where: { athleteId: athlete.id, trainerId: staff.sub, sessionAt: { gte: new Date(input.sessionAt.getTime() - 30 * 60000), lte: new Date(input.sessionAt.getTime() + 30 * 60000) } } })
  if (clash) throw new ApiError(409, 'CONFLICT', 'A session with this member is already logged around that time')
  const session = await db.ptSession.create({
    data: { gymId: gym.id, athleteId: athlete.id, trainerId: staff.sub, sessionAt: input.sessionAt, durationMin: input.durationMin, notes: input.notes.trim(), commissionPaise: commissionFor(trainer.ptSessionFeePaise, trainer.commissionPct) },
  })
  const lang = athlete.language as Lang
  const date = formatIstDate(input.sessionAt, { day: 'numeric', month: 'short' })
  await notifyAthlete(db, gym, athlete.id, { title: translate(lang, 'coach', 'notifPtTitle'), body: translate(lang, 'coach', 'notifPtBody', { trainer: firstName(trainer.name), date }), path: '', tag: `pt-${session.id}` })
  return session
}

export async function deletePtSession(db: TenantDb, staff: Staff, sessionId: string) {
  const session = await db.ptSession.findFirst({ where: { id: sessionId, ...(staff.kind === 'OWNER' ? {} : { trainerId: staff.sub }) } })
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found')
  if (session.athleteSignedAt) throw new ApiError(409, 'CONFLICT', 'The member already confirmed this session')
  await db.ptSession.delete({ where: { id: session.id } })
  return { ok: true }
}

// Member confirms ("yes, I trained") or disputes a logged session.
export async function answerPtSession(db: TenantDb, gymId: string, athlete: { id: string; name: string }, sessionId: string, action: 'sign' | 'dispute', note?: string) {
  const session = await db.ptSession.findFirst({ where: { id: sessionId, athleteId: athlete.id } })
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session not found')
  if (session.athleteSignedAt || session.athleteDisputedAt) throw new ApiError(409, 'CONFLICT', 'You already answered for this session')
  if (action === 'sign') {
    await db.ptSession.update({ where: { id: session.id }, data: { athleteSignedAt: new Date() } })
    // A confirmed session uses one PT session from the member's running plan, if it has any.
    const running = await db.membership.findFirst({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'FROZEN'] }, ptSessionsLeft: { gt: 0 } }, orderBy: { endsAt: 'desc' } })
    if (running) await db.membership.updateMany({ where: { id: running.id, ptSessionsLeft: { gt: 0 } }, data: { ptSessionsLeft: { decrement: 1 } } })
    return { status: 'signed' as const }
  }
  await db.ptSession.update({ where: { id: session.id }, data: { athleteDisputedAt: new Date(), disputeNote: note?.trim().slice(0, 200) || null } })
  const when = formatIstDate(session.sessionAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  await db.notification.create({ data: { gymId, recipientType: 'STAFF', recipientId: session.trainerId, title: `${athlete.name} disputed a PT session`, body: `${when}. ${note ?? ''}`.trim(), href: '/trainer/sessions' } })
  await notifyStaff(db, gymId, { title: `PT session disputed by ${athlete.name}`, body: `${when}. ${note ?? ''}`.trim(), href: '/owner/trainers' }, ['OWNER'])
  return { status: 'disputed' as const }
}

export function ptStatus(session: { athleteSignedAt: Date | null; athleteDisputedAt: Date | null }): 'signed' | 'disputed' | 'pending' {
  return session.athleteSignedAt ? 'signed' : session.athleteDisputedAt ? 'disputed' : 'pending'
}

export function monthRange(now: Date = new Date(), offset = 0) {
  const { year, month } = istParts(now)
  const start = new Date(Date.UTC(year, month + offset, 1) - IST_OFFSET_MS)
  const end = new Date(Date.UTC(year, month + offset + 1, 1) - IST_OFFSET_MS)
  return { start, end, label: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month + offset, 1))) }
}

export interface PtSummary {
  trainerId: string
  total: number
  signed: number
  pending: number
  disputed: number
  commissionPaise: number
}

// Commission is earned only on sessions the member confirmed.
export async function ptSummaries(db: TenantDb, range: { start: Date; end: Date }, trainerId?: string): Promise<Map<string, PtSummary>> {
  const sessions = await db.ptSession.findMany({ where: { sessionAt: { gte: range.start, lt: range.end }, ...(trainerId ? { trainerId } : {}) }, select: { trainerId: true, athleteSignedAt: true, athleteDisputedAt: true, commissionPaise: true } })
  const map = new Map<string, PtSummary>()
  for (const session of sessions) {
    const row = map.get(session.trainerId) ?? { trainerId: session.trainerId, total: 0, signed: 0, pending: 0, disputed: 0, commissionPaise: 0 }
    row.total += 1
    const status = ptStatus(session)
    row[status === 'signed' ? 'signed' : status === 'disputed' ? 'disputed' : 'pending'] += 1
    if (status === 'signed') row.commissionPaise += session.commissionPaise
    map.set(session.trainerId, row)
  }
  return map
}

// Owner: assign (or unassign) members to a trainer in bulk.
export async function assignTrainer(db: TenantDb, athleteIds: string[], trainerId: string | null) {
  if (trainerId) {
    const trainer = await db.gymUser.findFirst({ where: { id: trainerId, active: true, kind: { in: ['TRAINER', 'OWNER'] } }, select: { id: true } })
    if (!trainer) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an active trainer')
  }
  const result = await db.athlete.updateMany({ where: { id: { in: athleteIds }, archived: false }, data: { trainerId } })
  return { updated: result.count }
}
