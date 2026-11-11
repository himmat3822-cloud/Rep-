import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { computeRisk, computeWeeklyRisk, RISK_THRESHOLD, riskLevel, type RiskInput } from '@/lib/owner/risk'
import { convertLead, createLead, leadFunnel, logLeadContact, updateLead } from '@/lib/owner/leads'
import { atRiskList, createChallenge, createExpense, publishAnnouncement, recordRiskContact, updateComplaint } from '@/lib/owner/engagement'
import { monthBuckets, profitReport, revenueReport, duesReport } from '@/lib/owner/reports'
import { ownerInsights, ruleInsights, type InsightFacts } from '@/lib/owner/insights'
import { remindFollowUps } from '@/lib/owner/growth-jobs'
import { announcementSchema, challengeSchema, complaintUpdateSchema, enquirySchema, leadSchema, leadUpdateSchema } from '@/lib/validation/growth'
import { toCsv } from '@/lib/csv'
import type { PushTransport } from '@/lib/athlete/push'
import { purgeGymData } from '@/lib/platform/purge'
import { addDays, IST_OFFSET_MS, istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

const base: RiskInput = { visitsLast14: 6, visitsPrev56: 24, daysSinceLastVisit: 1, overdueDues: 0, overdueDays: 0, latePayments90: 0, planDaysLeft: 60, renewed: false, appDaysIdle: 2, memberDays: 200 }

describe('at-risk score (pure)', () => {
  it('a regular member scores zero', () => {
    expect(computeRisk(base)).toEqual({ score: 0, reasons: [] })
  })

  it('attendance drop is measured against the member own normal', () => {
    const r = computeRisk({ ...base, visitsLast14: 1, daysSinceLastVisit: 9 })
    // usual 6 per 2 weeks, now 1 -> 83% drop -> 33 points, plus 10 for 9 days away
    expect(r.score).toBe(43)
    expect(r.reasons[0]).toMatch(/Visits down 83%/)
    expect(r.score).toBeGreaterThanOrEqual(RISK_THRESHOLD)
  })

  it('new members are not punished for having no history', () => {
    expect(computeRisk({ ...base, visitsPrev56: 0, visitsLast14: 1, memberDays: 10, appDaysIdle: null }).score).toBe(0)
  })

  it('money, plan end and app idleness add up, capped at 100', () => {
    const r = computeRisk({ ...base, visitsLast14: 0, daysSinceLastVisit: 20, overdueDues: 1, overdueDays: 18, latePayments90: 3, planDaysLeft: 3, appDaysIdle: null })
    expect(r.score).toBe(100)
    expect(r.reasons.join(' | ')).toMatch(/overdue by 18 days.*Paid late 3 times.*Plan ends in 3 days.*Never opened/)
    expect(riskLevel(r.score)).toBe('high')
  })

  it('a renewed plan does not count as ending', () => {
    expect(computeRisk({ ...base, planDaysLeft: 2, renewed: true }).score).toBe(0)
  })
})

describe('growth validation', () => {
  it('lead phone is normalised and LOST needs a reason', () => {
    const lead = leadSchema.parse({ name: 'Aman', phone: '98765 43210', source: 'INSTAGRAM' })
    expect(lead.phone).toBe('+919876543210')
    expect(leadUpdateSchema.safeParse({ stage: 'LOST' }).success).toBe(false)
    expect(leadUpdateSchema.safeParse({ stage: 'LOST', lostReason: 'Too far' }).success).toBe(true)
  })

  it('enquiry honeypot is passed through so the route can drop bots silently', () => {
    expect(enquirySchema.parse({ name: 'Aman', phone: '9876543210', website: 'http://spam' }).website).toBe('http://spam')
    expect(enquirySchema.parse({ name: 'Aman', phone: '9876543210' }).website).toBe('')
  })

  it('challenge dates and complaint resolution are checked', () => {
    expect(challengeSchema.safeParse({ title: 'Long one', metric: 'visits', target: 10, startsAt: '2026-11-01', endsAt: '2027-03-01' }).success).toBe(false)
    expect(challengeSchema.safeParse({ title: 'Backwards', metric: 'visits', target: 10, startsAt: '2026-11-10', endsAt: '2026-11-01' }).success).toBe(false)
    expect(complaintUpdateSchema.safeParse({ status: 'RESOLVED' }).success).toBe(false)
    expect(announcementSchema.parse({ title: 'Diwali', body: 'Closed on Friday' }).push).toBe(true)
  })

  it('month buckets are IST months, oldest first', () => {
    const b = monthBuckets(3, new Date('2026-11-10T06:00:00Z'))
    expect(b.map((x) => x.key)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(b[2].start.toISOString()).toBe('2026-10-31T18:30:00.000Z')
  })

  it('rule insights speak plainly about the numbers', () => {
    const facts: InsightFacts = { revenueThisMonth: 5000000, revenueLastMonth: 8000000, revenueChangePct: -38, activeMembers: 80, joinedThisMonth: 4, churnPctLastMonth: 12, atRisk: 6, overdueCount: 3, overdueAmount: 450000, oldOverdueCount: 1, peakHour: 18, quietHour: 14, visitsPerDay: 41, leadConversionPct: 30, bestLeadSource: 'referral', openFollowUps: 2 }
    const lines = ruleInsights(facts)
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines[0]).toMatch(/38% behind last month/)
    expect(lines.join(' ')).toMatch(/at-risk list/)
  })

  it('CSV export neutralises formulas', () => {
    const out = toCsv([{ n: '=HYPERLINK("x")' }], [{ header: 'Name', value: (r) => r.n }])
    expect(out).toContain(`"'=HYPERLINK(""x"")"`)
    // Negative amounts stay numbers so the sheet can add them up.
    expect(toCsv([{ n: '-1250.50' }], [{ header: 'P', value: (r) => r.n }])).toContain('\r\n-1250.50\r\n')
  })
})

describe('growth (database)', () => {
  const db0 = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  const gymRef = () => ({ id: G.gym.id, slug: G.gym.slug })
  const pushes: string[] = []
  const transport: PushTransport = async (_s, payload) => {
    pushes.push(payload.title)
    return 'ok'
  }
  const now = new Date()
  const today = istDateOnly(now)
  const phone = () => `+9196${Math.floor(10000000 + Math.random() * 89999999)}`

  beforeAll(async () => {
    G = await makeGym(db0, 'Growth')
    db = scopeToGym(db0, G.gym.id)
  })

  afterAll(async () => {
    await purgeGymData(db0, G.gym.id)
  })

  it('leads: duplicates are refused, contact is logged, JOINED only via convert', async () => {
    await expect(createLead(db, G.gym.id, leadSchema.parse({ name: 'Already Member', phone: G.athlete.phone, source: 'WALK_IN' }))).rejects.toThrow(/already a member/)
    const lead = await createLead(db, G.gym.id, leadSchema.parse({ name: 'Simran Kaur', phone: phone(), source: 'INSTAGRAM', interest: 'Weight loss' }))
    expect(lead.stage).toBe('NEW')
    expect(lead.nextFollowUpAt!.getTime()).toBeGreaterThan(Date.now())
    await expect(createLead(db, G.gym.id, leadSchema.parse({ name: 'Again', phone: lead.phone, source: 'GOOGLE' }))).rejects.toThrow(/already in your leads/)

    const called = await logLeadContact(db, lead.id, 'Gurpreet', { note: 'Coming for a trial Saturday', stage: 'TRIAL' })
    expect(called.stage).toBe('TRIAL')
    expect(called.notes).toMatch(/\(Gurpreet\): Coming for a trial Saturday/)
    expect(called.lastContactAt).not.toBeNull()
    await expect(updateLead(db, lead.id, { stage: 'JOINED' })).rejects.toThrow(/Convert to member/)

    const { athleteId } = await convertLead(db, { id: G.gym.id, name: G.gym.name, settings: {} }, lead.id, G.branch.id)
    const member = await db.athlete.findFirst({ where: { id: athleteId } })
    expect(member?.phone).toBe(lead.phone)
    expect(member?.notes).toMatch(/Interest: Weight loss/)
    const after = await db.lead.findFirst({ where: { id: lead.id } })
    expect(after?.stage).toBe('JOINED')
    expect(after?.convertedAthleteId).toBe(athleteId)
    await expect(convertLead(db, { id: G.gym.id, name: G.gym.name, settings: {} }, lead.id, G.branch.id)).rejects.toThrow(/already a member/)
    await expect(logLeadContact(db, lead.id, 'X', { note: 'late call' })).rejects.toThrow(/closed/)
  })

  it('leads: lost with reason, funnel by source, follow-up reminders', async () => {
    const lost = await createLead(db, G.gym.id, leadSchema.parse({ name: 'Rohit', phone: phone(), source: 'INSTAGRAM' }))
    const saved = await updateLead(db, lost.id, { stage: 'LOST', lostReason: 'Too far' })
    expect(saved.nextFollowUpAt).toBeNull()
    const due = await createLead(db, G.gym.id, leadSchema.parse({ name: 'Due Today', phone: phone(), source: 'WALK_IN', nextFollowUpAt: new Date(Date.now() - 3600000) }))
    const funnel = await leadFunnel(db, addDays(today, -1))
    const insta = funnel.find((f) => f.source === 'INSTAGRAM')!
    expect(insta).toMatchObject({ total: 2, joined: 1, lost: 1, conversion: 50 })
    const reminded = await remindFollowUps(db, G.gym.id, now)
    expect(reminded).toBeGreaterThanOrEqual(1)
    const bell = await db.notification.findFirst({ where: { recipientType: 'STAFF', recipientId: G.owner.id }, orderBy: { createdAt: 'desc' } })
    expect(bell?.body).toMatch(/Due Today/)
    expect(due.source).toBe('WALK_IN')
  })

  it('weekly risk: lists the slipping member with reasons, keeps outcomes, drops recovered', async () => {
    const plan = await db.membershipPlan.create({ data: { gymId: G.gym.id, name: '3 months', durationDays: 90, pricePaise: 600000 } })
    const slipping = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'Slipping Sam', phone: phone(), referralCode: uniq('R'), joinedAt: addDays(now, -120), lastAppAt: addDays(now, -40) } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: slipping.id, planId: plan.id, startsAt: addDays(today, -85), endsAt: addDays(today, 5), pricePaise: 600000 } })
    // 3 visits a week for 8 weeks before the last 2, then one visit.
    const visits = []
    for (let d = 16; d < 70; d += 2) visits.push({ gymId: G.gym.id, branchId: G.branch.id, athleteId: slipping.id, method: 'MANUAL' as const, checkedInAt: new Date(addDays(today, -d).getTime() - IST_OFFSET_MS + 18 * 3600000) })
    visits.push({ gymId: G.gym.id, branchId: G.branch.id, athleteId: slipping.id, method: 'MANUAL' as const, checkedInAt: new Date(addDays(today, -12).getTime() - IST_OFFSET_MS + 18 * 3600000) })
    await db.checkIn.createMany({ data: visits })
    await db.athlete.update({ where: { id: slipping.id }, data: { lastVisitAt: visits.at(-1)!.checkedInAt } })
    await db.due.create({ data: { gymId: G.gym.id, athleteId: slipping.id, amountPaise: 200000, dueDate: addDays(today, -6) } })

    const run = await computeWeeklyRisk(db, G.gym.id, now)
    expect(run.atRisk).toBeGreaterThanOrEqual(1)
    const list = await atRiskList(db, now)
    const row = list.rows.find((r) => r.athleteId === slipping.id)!
    expect(row.score).toBeGreaterThanOrEqual(60)
    expect(row.plan).toBe('3 months')
    expect(row.reasons.join(' | ')).toMatch(/Visits down.*No visit in 12 days.*overdue by 6 days.*Plan ends in 5 days.*App not opened/)

    const noAnswer = await recordRiskContact(db, row.id, G.owner.id, { outcome: 'NO_ANSWER', note: '' })
    expect(noAnswer.contacted).toBe(false)
    const reached = await recordRiskContact(db, row.id, G.owner.id, { outcome: 'REACHED_COMING_BACK', note: 'Back Monday' })
    expect(reached.contacted).toBe(true)
    // Recompute: score refreshed, outcome kept.
    await computeWeeklyRisk(db, G.gym.id, now)
    const again = await db.riskScore.findFirst({ where: { id: row.id } })
    expect(again?.outcome).toBe('REACHED_COMING_BACK')
    expect(again?.note).toBe('Back Monday')

    // A different member who recovers drops off on the next run.
    const other = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'Comeback Kid', phone: phone(), referralCode: uniq('R'), joinedAt: addDays(now, -100) } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: other.id, planId: plan.id, startsAt: addDays(today, -80), endsAt: addDays(today, 3), pricePaise: 600000 } })
    await db.due.create({ data: { gymId: G.gym.id, athleteId: other.id, amountPaise: 100000, dueDate: addDays(today, -20) } })
    await computeWeeklyRisk(db, G.gym.id, now)
    expect(await db.riskScore.count({ where: { athleteId: other.id } })).toBe(1)
    await db.due.updateMany({ where: { athleteId: other.id }, data: { status: 'PAID', paidAt: now } })
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: other.id, planId: plan.id, startsAt: addDays(today, 4), endsAt: addDays(today, 94), pricePaise: 600000 } })
    await db.checkIn.create({ data: { gymId: G.gym.id, branchId: G.branch.id, athleteId: other.id, method: 'MANUAL', checkedInAt: now } })
    await db.athlete.update({ where: { id: other.id }, data: { lastVisitAt: now, lastAppAt: now } })
    await computeWeeklyRisk(db, G.gym.id, now)
    expect(await db.riskScore.count({ where: { athleteId: other.id } })).toBe(0)
  })

  it('announcements reach active members in the bell and by push', async () => {
    await db.pushSubscription.create({ data: { gymId: G.gym.id, athleteId: (await db.athlete.findFirstOrThrow({ where: { name: 'Slipping Sam' } })).id, endpoint: `https://push.example/${uniq('e')}`, p256dh: 'k', auth: 'a' } })
    const noon = new Date(`${today.toISOString().slice(0, 10)}T06:30:00Z`) // 12:00 IST, outside quiet hours
    const r = await publishAnnouncement(db, gymRef(), G.owner.id, announcementSchema.parse({ title: 'Closed on Diwali', body: 'Happy Diwali! We open again on Saturday.' }), transport, noon)
    expect(r.notified).toBeGreaterThanOrEqual(1)
    expect(r.pushed).toBe(1)
    expect(pushes).toContain('Closed on Diwali')
    expect((await db.announcement.findFirst({ where: { id: r.announcement.id } }))?.pushed).toBe(1)
    const silent = await publishAnnouncement(db, gymRef(), G.owner.id, announcementSchema.parse({ title: 'Quiet one', body: 'Only on the home screen', push: false }), transport, noon)
    expect(silent.notified).toBe(0)
  })

  it('challenges refuse overlaps and impossible targets', async () => {
    const start = today
    const end = addDays(today, 9)
    await expect(createChallenge(db, G.gym.id, challengeSchema.parse({ title: 'Too many', metric: 'visits', target: 20, startsAt: start, endsAt: end }))).rejects.toThrow(/more visits than there are days/)
    await createChallenge(db, G.gym.id, challengeSchema.parse({ title: '8 in 10', metric: 'visits', target: 8, startsAt: start, endsAt: end }))
    await expect(createChallenge(db, G.gym.id, challengeSchema.parse({ title: 'Overlap', metric: 'streak', target: 5, startsAt: addDays(today, 5), endsAt: addDays(today, 15) }))).rejects.toThrow(/already runs/)
  })

  it('resolving a complaint tells the member what was done', async () => {
    const c = await db.complaint.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, kind: 'EQUIPMENT', title: 'Treadmill 2', body: 'Belt slips' } })
    await updateComplaint(db, gymRef(), c.id, G.owner.id, { status: 'IN_PROGRESS', resolutionNote: '' }, transport)
    expect(await db.notification.count({ where: { recipientId: G.athlete.id, title: { startsWith: 'Fixed' } } })).toBe(0)
    const done = await updateComplaint(db, gymRef(), c.id, G.owner.id, { status: 'RESOLVED', resolutionNote: 'Belt replaced' }, transport)
    expect(done.resolvedById).toBe(G.owner.id)
    const bell = await db.notification.findFirst({ where: { recipientId: G.athlete.id, title: 'Fixed: Treadmill 2' } })
    expect(bell?.body).toBe('Belt replaced')
    // Resolving again does not notify twice.
    await updateComplaint(db, gymRef(), c.id, G.owner.id, { status: 'RESOLVED', resolutionNote: 'Belt replaced' }, transport)
    expect(await db.notification.count({ where: { recipientId: G.athlete.id, title: 'Fixed: Treadmill 2' } })).toBe(1)
  })

  it('reports: revenue by method, dues aging, profit after expenses', async () => {
    const paidAt = new Date(now.getTime() - 60000)
    await db.payment.createMany({
      data: [
        { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 118000, method: 'UPI', status: 'PAID', paidAt },
        { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 50000, method: 'CASH', status: 'PAID', paidAt },
        { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 99999, method: 'CASH', status: 'FAILED', paidAt },
      ],
    })
    await createExpense(db, G.gym.id, G.owner.id, { category: 'ELECTRICITY', amountRupees: 300, spentOn: now, note: '' })
    await expect(createExpense(db, G.gym.id, G.owner.id, { category: 'RENT', amountRupees: 10, spentOn: addDays(now, 5), note: '' })).rejects.toThrow(/future/)
    const rev = await revenueReport(db, 2, now)
    expect(rev).toHaveLength(2)
    expect(rev[1]).toMatchObject({ upi: 118000, cash: 50000, total: 168000, payments: 2 })
    const profit = await profitReport(db, 1, now)
    expect(profit[0]).toMatchObject({ revenue: 168000, expenses: 30000, profit: 138000, byCategory: { ELECTRICITY: 30000 } })
    const dues = await duesReport(db, now)
    expect(dues.aging[1].count).toBeGreaterThanOrEqual(1) // the 6-days-late due
    expect(dues.rows.every((r) => r.amountPaise > 0)).toBe(true)
  })

  it('insights fall back to rules when the AI is unavailable or rambles', async () => {
    const off = await ownerInsights(db, 'Growth Gym', now, async () => null)
    expect(off.source).toBe('rules')
    expect(off.insights.length).toBeGreaterThan(0)
    const junk = await ownerInsights(db, 'Growth Gym', now, async () => 'Sure! Here are some thoughts...')
    expect(junk.source).toBe('rules')
    const good = await ownerInsights(db, 'Growth Gym', now, async () => '["Call the 1 at-risk member before Friday.", "Collect the overdue dues this week with a personal call.", "Run a 2 PM off-peak offer to fill the quiet slot."]')
    expect(good.source).toBe('groq')
    expect(good.insights).toHaveLength(3)
  })
})
