import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { bookSlot, cancelBooking, listSlots } from '@/lib/athlete/slots'
import { approveClaim, rejectClaim, renewalQuote, requestFreeze, decideFreeze, submitClaim } from '@/lib/athlete/payments'
import { earnedBadgeKeys, evaluateAthlete } from '@/lib/athlete/badges'
import { leaderboard, longestRun, shortName } from '@/lib/athlete/progress'
import { buildDataExport } from '@/lib/athlete/export'
import { pushToAthlete, type PushTransport } from '@/lib/athlete/push'
import { sellMembership } from '@/lib/owner/money'
import { loadMessagingContext, sendGymMessage, type Transport } from '@/lib/messaging/send'
import { claimSchema, splitSchema } from '@/lib/validation/athlete'
import { purgeGymData } from '@/lib/platform/purge'
import { addDays, istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

const DAY = 86400000

describe('athlete app: pure helpers', () => {
  it('badges come from rule thresholds, never from unknown metrics', () => {
    const rules = [
      { key: 'first', metric: 'total_visits', threshold: 1, active: true },
      { key: 'streak7', metric: 'streak', threshold: 7, active: true },
      { key: 'off', metric: 'total_visits', threshold: 1, active: false },
      { key: 'champ', metric: 'challenge', threshold: 1, active: true },
    ]
    const metrics = { total_visits: 3, streak: 6, best_streak: 9, visits_before_7am: 0, visits_this_month: 3, records: 0 }
    expect(earnedBadgeKeys(rules, metrics)).toEqual(['first'])
  })

  it('leaderboard names are short and streak runs are counted on IST dates', () => {
    expect(shortName('Arjun Singh Mehta')).toBe('Arjun M.')
    expect(shortName('Simran')).toBe('Simran')
    expect(longestRun(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-03'])).toBe(3)
    expect(longestRun([])).toBe(0)
  })

  it('early renewal discount applies only to the plan price', () => {
    const plan = { pricePaise: 400000, joiningFeePaise: 50000, gstPercent: 18, gstInclusive: true }
    expect(renewalQuote(plan, 5, true)).toEqual({ discountPaise: 20000, totalPaise: 380000 })
    expect(renewalQuote(plan, 5, false)).toEqual({ discountPaise: 0, totalPaise: 400000 })
  })

  it('validates splits and UPI references', () => {
    expect(splitSchema.safeParse({ days: [{ weekday: 1, title: 'Push', exercises: [] }, { weekday: 1, title: 'Pull', exercises: [] }] }).success).toBe(false)
    expect(splitSchema.safeParse({ days: [{ weekday: 1, title: 'Push', exercises: [{ name: 'Bench', sets: 4, reps: '8-10' }] }] }).success).toBe(true)
    expect(claimSchema.safeParse({ kind: 'DUE', dueId: 'cmdue0000000001', amountRupees: 1500, utr: '412345678901' }).success).toBe(true)
    expect(claimSchema.safeParse({ kind: 'DUE', dueId: 'cmdue0000000001', amountRupees: 1500, utr: '41-2345' }).success).toBe(false)
    expect(claimSchema.safeParse({ kind: 'RENEWAL', amountRupees: 1500, utr: '412345678901' }).success).toBe(false)
  })
})

describe('athlete app (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  let plan: { id: string }
  let other: { id: string; name: string; phone: string }
  const actor = () => ({ staffId: G.owner.id })
  const today = istDateOnly()

  beforeAll(async () => {
    G = await makeGym(base, 'Athlete')
    db = scopeToGym(base, G.gym.id)
    await base.gym.update({ where: { id: G.gym.id }, data: { settings: { renewEarlyDiscountPct: 10, referralRewardDays: 7, memberUpiId: 'gym@okaxis' } } })
    plan = await db.membershipPlan.create({ data: { gymId: G.gym.id, name: 'Quarterly', durationDays: 90, pricePaise: 300000, joiningFeePaise: 0, maxFreezeDays: 10, gstPercent: 18, gstInclusive: true } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, planId: plan.id, status: 'ACTIVE', startsAt: addDays(today, -10), endsAt: addDays(today, 30), pricePaise: 300000 } })
    other = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'Other Person', phone: `+9196${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R') } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: other.id, planId: plan.id, status: 'ACTIVE', startsAt: addDays(today, -10), endsAt: addDays(today, 30), pricePaise: 300000 } })
  })

  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  it('slot booking: capacity is enforced, one per day, move and cancel give the spot back', async () => {
    const day = addDays(today, 1)
    const six = await db.slot.create({ data: { gymId: G.gym.id, branchId: G.branch.id, date: day, startHour: 18, capacity: 1 } })
    const seven = await db.slot.create({ data: { gymId: G.gym.id, branchId: G.branch.id, date: day, startHour: 19, capacity: 5 } })
    const branches = [G.branch.id]

    const first = await bookSlot(db, G.gym.id, G.athlete, six.id, branches)
    expect(first.startHour).toBe(18)
    await expect(bookSlot(db, G.gym.id, other, six.id, branches)).rejects.toThrow(/filled up/)
    await expect(bookSlot(db, G.gym.id, G.athlete, seven.id, branches)).rejects.toThrow(/already have a slot that day/)

    // Move 6 PM -> 7 PM: the 6 PM spot is free again for the other member.
    await bookSlot(db, G.gym.id, G.athlete, seven.id, branches, { replaceBookingId: first.id })
    expect((await db.slot.findFirstOrThrow({ where: { id: six.id } })).booked).toBe(0)
    const otherBooking = await bookSlot(db, G.gym.id, other, six.id, branches)
    const view = await listSlots(db, G.athlete.id, G.branch.id, day)
    expect(view.find((s) => s.id === seven.id)).toMatchObject({ mine: true, booked: 1, left: 4 })
    expect(view.find((s) => s.id === six.id)).toMatchObject({ mine: false, left: 0 })

    await cancelBooking(db, other.id, otherBooking.id)
    expect((await db.slot.findFirstOrThrow({ where: { id: six.id } })).booked).toBe(0)
    await expect(cancelBooking(db, G.athlete.id, otherBooking.id)).rejects.toThrow(/not found/)

    // Rebooking a cancelled slot reuses the row.
    const again = await bookSlot(db, G.gym.id, other, six.id, branches)
    expect(again.id).toBe(otherBooking.id)

    // Past slots and days outside the plan are refused.
    const past = await db.slot.create({ data: { gymId: G.gym.id, branchId: G.branch.id, date: addDays(today, -1), startHour: 18, capacity: 5 } })
    await expect(bookSlot(db, G.gym.id, G.athlete, past.id, branches)).rejects.toThrow(/already started/)
    const late = await db.slot.create({ data: { gymId: G.gym.id, branchId: G.branch.id, date: addDays(today, 6), startHour: 18, capacity: 5 } })
    const noPlan = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'No Plan', phone: `+9195${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R') } })
    await expect(bookSlot(db, G.gym.id, noPlan, late.id, branches)).rejects.toThrow(/does not cover/)
  })

  it("I've paid: claim, duplicate protection, desk confirms -> payment + invoice + notice", async () => {
    const due = await db.due.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 150000, dueDate: today, status: 'OPEN' } })
    const gym = { id: G.gym.id, name: G.gym.name, slug: G.gym.slug, settings: (await base.gym.findUniqueOrThrow({ where: { id: G.gym.id } })).settings }
    await expect(submitClaim(db, gym, G.athlete, { kind: 'DUE', dueId: due.id, amountPaise: 200000, utr: '412345678901' })).rejects.toThrow(/only/)
    const claim = await submitClaim(db, gym, G.athlete, { kind: 'DUE', dueId: due.id, amountPaise: 150000, utr: '412345678901' })
    await expect(submitClaim(db, gym, G.athlete, { kind: 'DUE', dueId: due.id, amountPaise: 150000, utr: '499999999999' })).rejects.toThrow(/already told/)
    expect(await db.notification.count({ where: { recipientType: 'STAFF', recipientId: G.owner.id } })).toBeGreaterThan(0)

    const result = await approveClaim(db, gym, claim.id, actor())
    expect(result.invoiceNumber).toBeTruthy()
    expect((await db.due.findFirstOrThrow({ where: { id: due.id } })).status).toBe('PAID')
    const saved = await db.memberPaymentClaim.findFirstOrThrow({ where: { id: claim.id } })
    expect(saved.status).toBe('APPROVED')
    expect(saved.paymentId).toBeTruthy()
    await expect(approveClaim(db, gym, claim.id, actor())).rejects.toThrow(/already handled/)
    expect(await db.notification.count({ where: { recipientType: 'ATHLETE', recipientId: G.athlete.id, title: 'Payment confirmed' } })).toBe(1)

    // The same UPI reference cannot be used twice.
    const due2 = await db.due.create({ data: { gymId: G.gym.id, athleteId: other.id, amountPaise: 50000, dueDate: today, status: 'OPEN' } })
    await expect(submitClaim(db, gym, other, { kind: 'DUE', dueId: due2.id, amountPaise: 50000, utr: '412345678901' })).rejects.toThrow(/already used/)
    const claim2 = await submitClaim(db, gym, other, { kind: 'DUE', dueId: due2.id, amountPaise: 50000, utr: 'ABC123456' })
    await rejectClaim(db, gym, claim2.id, 'Not in the bank yet', actor())
    expect((await db.memberPaymentClaim.findFirstOrThrow({ where: { id: claim2.id } })).status).toBe('REJECTED')
    expect((await db.due.findFirstOrThrow({ where: { id: due2.id } })).status).toBe('OPEN')
  })

  it('renew early by UPI: discount applied, new plan starts after the current one', async () => {
    const gym = { id: G.gym.id, name: G.gym.name, slug: G.gym.slug, settings: (await base.gym.findUniqueOrThrow({ where: { id: G.gym.id } })).settings }
    const claim = await submitClaim(db, gym, G.athlete, { kind: 'RENEWAL', planId: plan.id, amountPaise: 270000, utr: 'RENEW0001' })
    expect(claim.discountPaise).toBe(30000)
    await approveClaim(db, gym, claim.id, actor())
    const memberships = await db.membership.findMany({ where: { athleteId: G.athlete.id }, orderBy: { startsAt: 'asc' } })
    expect(memberships).toHaveLength(2)
    expect(memberships[1].startsAt.getTime()).toBe(memberships[0].endsAt.getTime() + DAY)
    expect(memberships[1].discountPaise).toBe(30000)
  })

  it('freeze request: limits, approval moves the end date, member is told', async () => {
    await expect(requestFreeze(db, G.gym.id, other, { fromDate: addDays(today, 2), days: 20, reason: 'Trip' })).rejects.toThrow(/up to 10 days/)
    const request = await requestFreeze(db, G.gym.id, other, { fromDate: addDays(today, 2), days: 5, reason: 'Family wedding' })
    await expect(requestFreeze(db, G.gym.id, other, { fromDate: addDays(today, 2), days: 2, reason: 'Again' })).rejects.toThrow(/already have/)
    const before = await db.membership.findFirstOrThrow({ where: { id: request.membershipId } })
    await decideFreeze(db, { id: G.gym.id, slug: G.gym.slug }, request.id, true, actor())
    const after = await db.membership.findFirstOrThrow({ where: { id: request.membershipId } })
    expect(after.endsAt.getTime() - before.endsAt.getTime()).toBe(5 * DAY)
    expect(after.freezeDaysUsed).toBe(5)
    expect(await db.notification.count({ where: { recipientId: other.id, title: 'Freeze approved' } })).toBe(1)
  })

  it('refer a friend: first paid plan rewards the referrer once', async () => {
    const friend = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'New Friend', phone: `+9194${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R'), referredById: other.id } })
    const gym = { id: G.gym.id, name: G.gym.name, settings: (await base.gym.findUniqueOrThrow({ where: { id: G.gym.id } })).settings }
    const before = await db.membership.findFirstOrThrow({ where: { athleteId: other.id, status: 'ACTIVE' }, orderBy: { endsAt: 'desc' } })
    const sale = await sellMembership(db, gym, { athleteId: friend.id, planId: plan.id, discountPaise: 0, amountPaidPaise: 300000, method: 'CASH', includeJoiningFee: false }, actor())
    expect(sale.referral).toMatchObject({ referrerId: other.id, days: 7 })
    const after = await db.membership.findFirstOrThrow({ where: { id: before.id } })
    expect(after.endsAt.getTime() - before.endsAt.getTime()).toBe(7 * DAY)
    const again = await sellMembership(db, gym, { athleteId: friend.id, planId: plan.id, discountPaise: 0, amountPaidPaise: 300000, method: 'CASH', includeJoiningFee: false }, actor())
    expect(again.referral).toBeNull()
    expect(await db.referral.count({ where: { referredAthleteId: friend.id } })).toBe(1)
  })

  it('badges and challenges are evaluated from attendance', async () => {
    const challenge = await db.challenge.create({ data: { gymId: G.gym.id, title: 'Two days', description: '', metric: 'visits', target: 2, startsAt: addDays(today, -3), endsAt: addDays(today, 3), badgeKey: 'champ' } })
    for (const daysAgo of [0, 1]) {
      await db.checkIn.create({ data: { gymId: G.gym.id, branchId: G.branch.id, athleteId: G.athlete.id, method: 'MANUAL', checkedInAt: new Date(Date.now() - daysAgo * DAY) } })
    }
    const rules = [
      { key: 'first', name: 'First', description: 'First visit', icon: 'x', metric: 'total_visits', threshold: 1, active: true },
      { key: 'champ', name: 'Champ', description: 'Challenge', icon: 'x', metric: 'challenge', threshold: 1, active: true },
    ]
    const pushes: string[] = []
    const transport: PushTransport = async (_sub, payload) => {
      pushes.push(payload.title)
      return 'ok'
    }
    const result = await evaluateAthlete(db, { id: G.gym.id, slug: G.gym.slug }, G.athlete.id, rules, new Date(), transport)
    expect(result.newBadges.sort()).toEqual(['champ', 'first'])
    const entry = await db.challengeEntry.findFirstOrThrow({ where: { challengeId: challenge.id, athleteId: G.athlete.id } })
    expect(entry.progress).toBe(2)
    expect(entry.completedAt).not.toBeNull()
    expect((await evaluateAthlete(db, { id: G.gym.id, slug: G.gym.slug }, G.athlete.id, rules)).newBadges).toEqual([])
  })

  it('leaderboard: attendance only, hidden members left out', async () => {
    await db.athlete.update({ where: { id: other.id }, data: { hideFromLeaderboard: true } })
    await db.checkIn.create({ data: { gymId: G.gym.id, branchId: G.branch.id, athleteId: other.id, method: 'MANUAL', checkedInAt: new Date() } })
    const board = await leaderboard(db, G.athlete.id)
    expect(board.rows.some((row) => row.athleteId === other.id)).toBe(false)
    expect(board.me?.rank).toBe(1)
    const hidden = await leaderboard(db, other.id)
    expect(hidden.hidden).toBe(true)
    expect(hidden.me).toBeNull()
  })

  it('push first: phone gets it free; a dead subscription is removed and WhatsApp takes over', async () => {
    const whatsapp: string[] = []
    const transport: Transport = async (message) => {
      whatsapp.push(message.template)
      return { providerId: `wamid.${uniq('p')}`, skipped: false }
    }
    const plan2 = await base.platformPlan.upsert({ where: { code: 'push-plan' }, create: { code: 'push-plan', name: 'Push', monthlyPricePaise: 1, annualPricePaise: 1, branchLimit: 1, whatsappQuota: 50, features: [] }, update: {} })
    await base.gymSubscription.create({ data: { gymId: G.gym.id, planId: plan2.id, status: 'ACTIVE' } })
    await db.pushSubscription.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, endpoint: `https://push.example/${uniq('e')}`, p256dh: 'p'.repeat(30), auth: 'a'.repeat(12) } })
    let pushResult: 'ok' | 'gone' = 'ok'
    const push: PushTransport = async () => pushResult
    const ctx = await loadMessagingContext(base, G.gym.id, transport, push)
    const ten = new Date(Date.parse(`${today.toISOString().slice(0, 10)}T10:00:00+05:30`))
    const message = { template: 'kasrat_birthday' as const, language: 'EN' as const, params: ['A', 'B'], to: { phone: G.athlete.phone, athleteId: G.athlete.id }, purpose: 'birthday', pushFirst: { title: 'Gym', path: '' } }

    const pushed = await sendGymMessage(base, ctx, { ...message, dedupeKey: uniq('k') }, ten)
    expect(pushed.outcome).toBe('sent')
    expect((await base.messageLog.findUniqueOrThrow({ where: { id: pushed.logId } })).channel).toBe('PUSH')
    expect(whatsapp).toHaveLength(0)

    pushResult = 'gone'
    const fallback = await sendGymMessage(base, ctx, { ...message, dedupeKey: uniq('k') }, ten)
    expect(fallback.outcome).toBe('sent')
    expect((await base.messageLog.findUniqueOrThrow({ where: { id: fallback.logId } })).channel).toBe('WHATSAPP')
    expect(whatsapp).toEqual(['kasrat_birthday'])
    expect(await db.pushSubscription.count({ where: { athleteId: G.athlete.id } })).toBe(0)
    expect(await pushToAthlete(db, G.athlete.id, { title: 'x', body: 'y', url: '/' }, push)).toBe(0)
  })

  it('data export holds only my own data', async () => {
    const data = await buildDataExport(db, { id: G.gym.id, name: G.gym.name }, G.athlete.id)
    expect(data.profile.memberCode).toBe(G.athlete.memberCode)
    expect(data.memberships.length).toBeGreaterThan(0)
    expect(data.paymentClaims.every((claim) => claim.upiReference !== 'ABC123456')).toBe(true)
    expect(JSON.stringify(data)).not.toContain(other.phone)
  })
})
