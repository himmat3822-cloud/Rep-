import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { addNote, answerPtSession, applyTemplate, assignSplit, assignTrainer, commissionFor, deleteNote, deletePtSession, logPtSession, monthRange, ptSummaries, releaseSplit, rosterAthlete, sendNudge } from '@/lib/trainer/service'
import { loadRoster } from '@/lib/trainer/roster'
import { nudgeLine } from '@/lib/messaging/templates'
import { nudgeSchema, ptLogSchema } from '@/lib/validation/trainer'
import type { Transport } from '@/lib/messaging/send'
import { purgeGymData } from '@/lib/platform/purge'
import { addDays, istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

describe('trainer: pure helpers', () => {
  it('commission is fee x percent, clamped', () => {
    expect(commissionFor(60000, 40)).toBe(24000)
    expect(commissionFor(60000, 150)).toBe(60000)
    expect(commissionFor(-5, 40)).toBe(0)
  })

  it('nudge lines are in the member language and need text when custom', () => {
    expect(nudgeLine('EN', 'missed', 6)).toContain('6 days')
    expect(nudgeLine('HI', 'streak', 9)).toContain('9')
    expect(nudgeLine('HI', 'missed', 3)).not.toBe(nudgeLine('EN', 'missed', 3))
    expect(nudgeSchema.safeParse({ kind: 'custom' }).success).toBe(false)
    expect(nudgeSchema.safeParse({ kind: 'custom', text: 'two\nlines' }).success).toBe(false)
    expect(nudgeSchema.safeParse({ kind: 'missed' }).success).toBe(true)
    expect(ptLogSchema.safeParse({ athleteId: 'cmathlete000001', sessionAt: '2026-11-10T10:00:00+05:30', durationMin: 5 }).success).toBe(false)
  })
})

describe('trainer desk (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  let trainerA: { id: string; name: string }
  let trainerB: { id: string; name: string }
  let mine: { id: string }
  let theirs: { id: string }
  const A = () => ({ sub: trainerA.id, kind: 'TRAINER' as const, name: trainerA.name })
  const B = () => ({ sub: trainerB.id, kind: 'TRAINER' as const, name: trainerB.name })
  const gymRef = () => ({ id: G.gym.id, slug: G.gym.slug })
  const today = istDateOnly()

  beforeAll(async () => {
    G = await makeGym(base, 'Coach')
    db = scopeToGym(base, G.gym.id)
    const role = await db.role.create({ data: { gymId: G.gym.id, key: 'TRAINER', name: 'Trainer', permissions: ['workouts.manage', 'pt.log'], isSystem: true } })
    trainerA = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Harjot Sandhu', phone: `+9193${Math.floor(10000000 + Math.random() * 89999999)}`, commissionPct: 40, ptSessionFeePaise: 60000 } })
    trainerB = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Neha Arora', phone: `+9192${Math.floor(10000000 + Math.random() * 89999999)}` } })
    mine = await db.athlete.update({ where: { id: G.athlete.id }, data: { trainerId: trainerA.id } })
    theirs = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'Other Member', phone: `+9191${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R'), trainerId: trainerB.id } })
    const plan = await db.membershipPlan.create({ data: { gymId: G.gym.id, name: 'PT pack', durationDays: 30, pricePaise: 500000 } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: mine.id, planId: plan.id, status: 'ACTIVE', startsAt: addDays(today, -5), endsAt: addDays(today, 25), pricePaise: 500000, ptSessionsLeft: 4 } })
  })

  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  it('a trainer only sees their own roster; owners see everyone', async () => {
    await expect(rosterAthlete(db, A(), theirs.id)).rejects.toThrow(/not on your roster/)
    expect((await rosterAthlete(db, A(), mine.id)).id).toBe(mine.id)
    expect((await rosterAthlete(db, { sub: G.owner.id, kind: 'OWNER', name: 'Owner' }, theirs.id)).id).toBe(theirs.id)
    const roster = await loadRoster(db, A())
    expect(roster.map((r) => r.id)).toEqual([mine.id])
    expect(roster[0]).toMatchObject({ ptLeft: 4, hasPlan: false })
    // No money on roster rows.
    expect(Object.keys(roster[0]).some((key) => /paise|due|amount/i.test(key))).toBe(false)
  })

  it('assigning a split replaces the member plan and tells the member; hand back works', async () => {
    await db.workoutSplit.create({ data: { gymId: G.gym.id, athleteId: mine.id, days: { days: [] } } })
    const split = await assignSplit(db, gymRef(), A(), mine.id, { days: [{ weekday: 1, title: 'Push', focus: '', minutes: 60, exercises: [{ name: 'Bench', sets: 4, reps: '8' }] }], dietNotes: 'More dal' })
    const active = await db.workoutSplit.findMany({ where: { athleteId: mine.id, active: true } })
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ id: split.id, createdById: trainerA.id, dietNotes: 'More dal' })
    expect(await db.notification.count({ where: { recipientId: mine.id, title: 'New workout plan' } })).toBe(1)
    await expect(assignSplit(db, gymRef(), B(), mine.id, { days: [], dietNotes: '' })).rejects.toThrow(/not on your roster/)
    expect((await releaseSplit(db, A(), mine.id)).released).toBe(1)
  })

  it('templates can only be given to your own members', async () => {
    const template = await db.workoutTemplate.create({ data: { gymId: G.gym.id, createdById: trainerB.id, name: 'PPL', days: { days: [{ weekday: 2, title: 'Pull', focus: '', minutes: 60, exercises: [] }] } } })
    await expect(applyTemplate(db, gymRef(), A(), template.id, [mine.id, theirs.id])).rejects.toThrow(/not on your roster/)
    expect((await applyTemplate(db, gymRef(), A(), template.id, [mine.id])).applied).toBe(1)
    const active = await db.workoutSplit.findFirstOrThrow({ where: { athleteId: mine.id, active: true } })
    expect((active.days as { days: { title: string }[] }).days[0].title).toBe('Pull')
  })

  it('notes reach the member; only the author deletes them', async () => {
    const note = await addNote(db, gymRef(), A(), mine.id, 'Great squats today')
    expect(await db.notification.count({ where: { recipientId: mine.id, title: 'New note from Harjot' } })).toBe(1)
    await expect(deleteNote(db, B(), note.id)).rejects.toThrow(/not found/)
    expect((await deleteNote(db, A(), note.id)).ok).toBe(true)
  })

  it('PT: log, member confirms (uses a pack session), commission only when confirmed', async () => {
    const now = new Date()
    await expect(logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: new Date(now.getTime() + 3600000), durationMin: 60, notes: '' })).rejects.toThrow(/after it happens/)
    await expect(logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: addDays(now, -20), durationMin: 60, notes: '' })).rejects.toThrow(/14 days/)
    await expect(logPtSession(db, gymRef(), A(), { athleteId: theirs.id, sessionAt: now, durationMin: 60, notes: '' })).rejects.toThrow(/not on your roster/)

    const s1 = await logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: new Date(now.getTime() - 2 * 3600000), durationMin: 60, notes: 'Legs' })
    expect(s1.commissionPaise).toBe(24000)
    await expect(logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: new Date(now.getTime() - 2 * 3600000 + 10 * 60000), durationMin: 60, notes: '' })).rejects.toThrow(/already logged/)
    const s2 = await logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: new Date(now.getTime() - 26 * 3600000), durationMin: 45, notes: '' })
    const s3 = await logPtSession(db, gymRef(), A(), { athleteId: mine.id, sessionAt: new Date(now.getTime() - 50 * 3600000), durationMin: 45, notes: '' })
    expect(await db.notification.count({ where: { recipientId: mine.id, title: 'Confirm your PT session' } })).toBe(3)

    const member = { id: mine.id, name: 'Coach Athlete' }
    expect((await answerPtSession(db, G.gym.id, member, s1.id, 'sign')).status).toBe('signed')
    await expect(answerPtSession(db, G.gym.id, member, s1.id, 'dispute')).rejects.toThrow(/already answered/)
    expect((await answerPtSession(db, G.gym.id, member, s2.id, 'dispute', 'Not that day')).status).toBe('disputed')
    await expect(answerPtSession(db, G.gym.id, { id: theirs.id, name: 'x' }, s3.id, 'sign')).rejects.toThrow(/not found/)
    expect(await db.notification.count({ where: { recipientId: trainerA.id, recipientType: 'STAFF' } })).toBe(1)

    const membership = await db.membership.findFirstOrThrow({ where: { athleteId: mine.id } })
    expect(membership.ptSessionsLeft).toBe(3)

    const summary = (await ptSummaries(db, monthRange(), trainerA.id)).get(trainerA.id)!
    // s3 may fall in the previous month near the 1st, so check the confirmed money only.
    expect(summary.signed).toBe(1)
    expect(summary.commissionPaise).toBe(24000)

    await expect(deletePtSession(db, A(), s1.id)).rejects.toThrow(/already confirmed/)
    await expect(deletePtSession(db, B(), s3.id)).rejects.toThrow(/not found/)
    expect((await deletePtSession(db, A(), s3.id)).ok).toBe(true)
  })

  it('nudge: once a day, in their language, never at night', async () => {
    const plan = await base.platformPlan.upsert({ where: { code: 'coach-plan' }, create: { code: 'coach-plan', name: 'Coach', monthlyPricePaise: 1, annualPricePaise: 1, branchLimit: 1, whatsappQuota: 50, features: [] }, update: {} })
    await base.gymSubscription.create({ data: { gymId: G.gym.id, planId: plan.id, status: 'ACTIVE' } })
    await db.athlete.update({ where: { id: mine.id }, data: { language: 'PA', lastVisitAt: addDays(new Date(), -5) } })
    const sent: string[][] = []
    const whatsapp: Transport = async (message) => {
      sent.push(message.bodyParams ?? [])
      return { providerId: `wamid.${uniq('n')}`, skipped: false }
    }
    const ten = new Date(Date.parse(`${today.toISOString().slice(0, 10)}T10:00:00+05:30`))
    const result = await sendNudge(base, db, { id: G.gym.id, name: 'Coach Gym' }, A(), mine.id, { kind: 'missed' }, ten, { whatsapp })
    expect(result.ok).toBe(true)
    expect(sent[0][1]).toBe('Harjot')
    expect(sent[0][2]).toBe(nudgeLine('PA', 'missed', 5))
    await expect(sendNudge(base, db, { id: G.gym.id, name: 'Coach Gym' }, A(), mine.id, { kind: 'streak' }, ten, { whatsapp })).rejects.toThrow(/already got a nudge/)
    const night = new Date(Date.parse(`${addDays(today, 1).toISOString().slice(0, 10)}T22:30:00+05:30`))
    await expect(sendNudge(base, db, { id: G.gym.id, name: 'Coach Gym' }, A(), mine.id, { kind: 'missed' }, night, { whatsapp })).rejects.toThrow(/9 PM/)
    await expect(sendNudge(base, db, { id: G.gym.id, name: 'Coach Gym' }, A(), theirs.id, { kind: 'missed' }, ten, { whatsapp })).rejects.toThrow(/not on your roster/)
  })

  it('owner assigns members to a trainer in bulk', async () => {
    expect((await assignTrainer(db, [theirs.id], trainerA.id)).updated).toBe(1)
    expect((await loadRoster(db, A())).map((r) => r.id).sort()).toEqual([mine.id, theirs.id].sort())
    await expect(assignTrainer(db, [theirs.id], G.athlete.id)).rejects.toThrow(/active trainer/)
    expect((await assignTrainer(db, [theirs.id], null)).updated).toBe(1)
  })
})
