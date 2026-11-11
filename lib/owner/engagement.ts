import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { isQuietHour } from '@/lib/messaging/policy'
import { pushToAthlete, type PushTransport } from '@/lib/athlete/push'
import { notifyAthlete } from '@/lib/athlete/notify'
import { istDateOnly } from '@/lib/time'
import { mondayOf } from '@/lib/attendance/jobs'
import type { AnnouncementOutput, ChallengeOutput, ExpenseOutput } from '@/lib/validation/growth'

// Owner engagement tools: announcements (in-app + push), monthly
// challenges, the complaints / equipment board, expenses and the
// at-risk "who did you call" outcomes.

// ---------------------------------------------------------------- announcements

export async function publishAnnouncement(db: TenantDb, gym: { id: string; slug: string }, staffId: string, input: AnnouncementOutput, transport?: PushTransport, now: Date = new Date()) {
  if (input.branchId) {
    const branch = await db.branch.findFirst({ where: { id: input.branchId }, select: { id: true } })
    if (!branch) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a valid branch')
  }
  if (input.expiresAt && input.expiresAt <= now) throw new ApiError(422, 'VALIDATION_ERROR', 'The end date must be in the future')
  const announcement = await db.announcement.create({
    data: { gymId: gym.id, branchId: input.branchId ?? null, title: input.title, body: input.body, pinned: input.pinned, expiresAt: input.expiresAt ?? null, createdById: staffId },
  })
  if (!input.push) return { announcement, notified: 0, pushed: 0 }

  // Every active member (of the branch, if one was picked) gets it in the bell.
  const live = await db.membership.findMany({ where: { status: { in: ['ACTIVE', 'FROZEN'] } }, select: { athleteId: true }, distinct: ['athleteId'] })
  const members = await db.athlete.findMany({
    where: { archived: false, id: { in: live.map((m) => m.athleteId) }, ...(input.branchId ? { homeBranchId: input.branchId } : {}) },
    select: { id: true },
  })
  const href = `/g/${gym.slug}`
  if (members.length) {
    await db.notification.createMany({ data: members.map((m) => ({ gymId: gym.id, recipientType: 'ATHLETE' as const, recipientId: m.id, title: input.title, body: input.body.slice(0, 240), href })) })
  }
  // Push only to members who installed the app and allowed notifications;
  // during quiet hours the bell is enough.
  let pushed = 0
  if (!isQuietHour(now)) {
    const subscribed = await db.pushSubscription.findMany({ where: { athleteId: { in: members.map((m) => m.id) } }, select: { athleteId: true }, distinct: ['athleteId'] })
    for (const row of subscribed) {
      try {
        const delivered = await pushToAthlete(db, row.athleteId, { title: input.title, body: input.body.slice(0, 160), url: href, tag: `ann-${announcement.id}` }, transport)
        if (delivered) pushed += 1
      } catch (error) {
        console.error('[announce] push failed', row.athleteId, error)
      }
    }
  }
  const saved = await db.announcement.update({ where: { id: announcement.id }, data: { pushed } })
  return { announcement: saved, notified: members.length, pushed }
}

export async function endAnnouncement(db: TenantDb, id: string, now: Date = new Date()) {
  const row = await db.announcement.findFirst({ where: { id } })
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Announcement not found')
  return db.announcement.update({ where: { id }, data: { expiresAt: now, pinned: false } })
}

// ---------------------------------------------------------------- challenges

export const CHALLENGE_BADGE = 'challenge_champ'

export async function createChallenge(db: TenantDb, gymId: string, input: ChallengeOutput, now: Date = new Date()) {
  const startsAt = istDateOnly(input.startsAt)
  const endsAt = istDateOnly(input.endsAt)
  if (endsAt < istDateOnly(now)) throw new ApiError(422, 'VALIDATION_ERROR', 'This challenge would already be over')
  if (input.metric === 'visits' && input.target > Math.round((endsAt.getTime() - startsAt.getTime()) / 86400000) + 1) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The target is more visits than there are days in the challenge')
  }
  const overlap = await db.challenge.findFirst({ where: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt } }, select: { title: true } })
  if (overlap) throw new ApiError(409, 'CONFLICT', `"${overlap.title}" already runs in these dates. Members see one challenge at a time.`)
  return db.challenge.create({
    data: { gymId, title: input.title, description: input.description, metric: input.metric, target: input.target, startsAt, endsAt, badgeKey: input.badge ? CHALLENGE_BADGE : null },
  })
}

export async function deleteChallenge(db: TenantDb, id: string) {
  const row = await db.challenge.findFirst({ where: { id } })
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Challenge not found')
  await db.challengeEntry.deleteMany({ where: { challengeId: id } })
  await db.challenge.deleteMany({ where: { id } })
  return { deleted: true }
}

// ---------------------------------------------------------------- complaints

export async function updateComplaint(db: TenantDb, gym: { id: string; slug: string }, id: string, staffId: string, input: { status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'; resolutionNote: string }, transport?: PushTransport) {
  const row = await db.complaint.findFirst({ where: { id } })
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Complaint not found')
  const resolving = input.status === 'RESOLVED' && row.status !== 'RESOLVED'
  const saved = await db.complaint.update({
    where: { id },
    data: {
      status: input.status,
      ...(input.status === 'RESOLVED' ? { resolutionNote: input.resolutionNote, resolvedById: staffId, resolvedAt: row.resolvedAt ?? new Date() } : { resolvedAt: null, resolvedById: null }),
    },
  })
  // Close the loop with the member who raised it.
  if (resolving && row.athleteId) {
    await notifyAthlete(db, gym, row.athleteId, { title: `Fixed: ${row.title}`, body: input.resolutionNote, path: '/notifications', tag: `complaint-${row.id}` }, transport)
  }
  return saved
}

// ---------------------------------------------------------------- expenses

export async function createExpense(db: TenantDb, gymId: string, staffId: string, input: ExpenseOutput, now: Date = new Date()) {
  if (input.spentOn > new Date(now.getTime() + 86400000)) throw new ApiError(422, 'VALIDATION_ERROR', 'The date cannot be in the future')
  if (input.branchId) {
    const branch = await db.branch.findFirst({ where: { id: input.branchId }, select: { id: true } })
    if (!branch) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a valid branch')
  }
  return db.expense.create({
    data: { gymId, branchId: input.branchId ?? null, category: input.category, amountPaise: Math.round(input.amountRupees * 100), spentOn: istDateOnly(input.spentOn), note: input.note, createdById: staffId },
  })
}

export async function deleteExpense(db: TenantDb, id: string) {
  const row = await db.expense.findFirst({ where: { id } })
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Expense not found')
  await db.expense.deleteMany({ where: { id } })
  return { deleted: true }
}

// ---------------------------------------------------------------- at-risk outcomes

export async function recordRiskContact(db: TenantDb, id: string, staffId: string, input: { outcome: 'REACHED_COMING_BACK' | 'REACHED_NOT_INTERESTED' | 'NO_ANSWER' | 'RENEWED'; note: string }) {
  const row = await db.riskScore.findFirst({ where: { id } })
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Entry not found')
  // "No answer" keeps the member on the list so someone tries again.
  return db.riskScore.update({
    where: { id },
    data: { contacted: input.outcome !== 'NO_ANSWER', outcome: input.outcome, note: input.note || null, contactedById: staffId, contactedAt: new Date() },
  })
}

export async function atRiskList(db: TenantDb, now: Date = new Date()) {
  const weekOf = mondayOf(istDateOnly(now))
  const rows = await db.riskScore.findMany({ where: { weekOf }, orderBy: [{ contacted: 'asc' }, { score: 'desc' }] })
  const ids = rows.map((r) => r.athleteId)
  const [athletes, memberships] = ids.length
    ? await Promise.all([
        db.athlete.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, name: true, phone: true, lastVisitAt: true, trainer: { select: { name: true } } } }),
        db.membership.findMany({ where: { athleteId: { in: ids }, status: { in: ['ACTIVE', 'FROZEN', 'EXPIRED'] } }, orderBy: { endsAt: 'desc' }, select: { athleteId: true, endsAt: true, planId: true } }),
      ])
    : [[], []]
  const plans = memberships.length ? await db.membershipPlan.findMany({ where: { id: { in: [...new Set(memberships.map((m) => m.planId))] } }, select: { id: true, name: true } }) : []
  const planName = new Map(plans.map((p) => [p.id, p.name]))
  const latest = new Map<string, { endsAt: Date; planId: string }>()
  for (const m of memberships) if (!latest.has(m.athleteId)) latest.set(m.athleteId, m)
  const byId = new Map(athletes.map((a) => [a.id, a]))
  const staffIds = [...new Set(rows.map((r) => r.contactedById).filter((x): x is string => Boolean(x)))]
  const staff = staffIds.length ? await db.gymUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : []
  const staffName = new Map(staff.map((s) => [s.id, s.name]))
  return {
    weekOf,
    rows: rows
      .filter((r) => byId.has(r.athleteId))
      .map((r) => {
        const a = byId.get(r.athleteId)!
        const m = latest.get(a.id)
        return {
          id: r.id,
          athleteId: a.id,
          name: a.name,
          phone: a.phone,
          trainer: a.trainer?.name ?? null,
          plan: m ? planName.get(m.planId) ?? null : null,
          endsAt: m?.endsAt ?? null,
          lastVisitAt: a.lastVisitAt,
          score: r.score,
          reasons: r.reasons,
          contacted: r.contacted,
          outcome: r.outcome,
          note: r.note,
          contactedBy: r.contactedById ? staffName.get(r.contactedById) ?? null : null,
          contactedAt: r.contactedAt,
        }
      }),
  }
}
