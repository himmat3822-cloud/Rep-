import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { detectColumns, mapRows, parseCsv, parseDate, parseMoney } from '@/lib/import/members-file'
import { commitImport, previewImport } from '@/lib/owner/member-import'
import { addMemberMessage, createQuery, memberQueries, openQueryCount, replyToQuery, staffQueries } from '@/lib/queries/service'
import { getBranchComparison, getOwnerOverview } from '@/lib/owner/overview'
import { leaderboard } from '@/lib/athlete/progress'
import { memberImportSchema } from '@/lib/validation/owner'
import { queryCreateSchema } from '@/lib/validation/queries'
import { purgeGymData } from '@/lib/platform/purge'
import { addDays, istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

const iso = (date: Date) => date.toISOString().slice(0, 10)
const dmy = (date: Date) => iso(date).split('-').reverse().join('/')

describe('member import: file parsing', () => {
  it('reads CSV with quotes, semicolons and a BOM', () => {
    expect(parseCsv('\uFEFFName,Mobile\r\n"Singh, Jagtar",98765 43210\r\n\r\n')).toEqual([
      ['Name', 'Mobile'],
      ['Singh, Jagtar', '98765 43210'],
    ])
    expect(parseCsv('a;b\n1;"x ""quoted"" y"')).toEqual([
      ['a', 'b'],
      ['1', 'x "quoted" y'],
    ])
  })

  it('reads Indian date formats day first, and Excel serials', () => {
    expect(parseDate('21/11/2026')).toBe('2026-11-21')
    expect(parseDate('05-01-25')).toBe('2025-01-05')
    expect(parseDate('2026-11-21')).toBe('2026-11-21')
    expect(parseDate('21 Nov 2026')).toBe('2026-11-21')
    expect(parseDate('21-Nov-26')).toBe('2026-11-21')
    expect(parseDate('46347')).toBe('2026-11-21')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('next week')).toBeNull()
  })

  it('reads money with rupee signs, commas and /-', () => {
    expect(parseMoney('Rs. 1,500')).toBe(150000)
    expect(parseMoney('\u20B9 4500.50')).toBe(450050)
    expect(parseMoney('1500/-')).toBe(150000)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('matches column names from common exports', () => {
    const map = detectColumns(['Sr No', 'Member Name', 'Mobile No.', 'Package', 'Valid Till', 'Balance Amount', 'Joining Date', 'Branch'])
    expect(map).toMatchObject({ name: 1, phone: 2, plan: 3, end: 4, due: 5, joined: 6, branch: 7 })
    const rows = mapRows([['Member Name', 'Mobile No.'], ['Aman', '9876500001']], detectColumns(['Member Name', 'Mobile No.']))
    expect(rows).toEqual([{ name: 'Aman', phone: '9876500001' }])
  })

  it('caps one import at 2000 rows', () => {
    expect(memberImportSchema.safeParse({ rows: Array.from({ length: 2001 }, () => ({ name: 'A', phone: '9876500001' })) }).success).toBe(false)
    expect(memberImportSchema.safeParse({ rows: [] }).success).toBe(false)
  })
})

describe('member import (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  const today = istDateOnly()

  beforeAll(async () => {
    G = await makeGym(base, 'Import')
    db = scopeToGym(base, G.gym.id)
    await db.membershipPlan.create({ data: { gymId: G.gym.id, name: 'Quarterly', durationDays: 90, pricePaise: 450000 } })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  const rows = () => [
    { name: 'Harpreet Kaur', phone: '9876500101', plan: 'Quarterly', start: dmy(addDays(today, -30)), end: dmy(addDays(today, 60)), paid: '4500', due: '0', code: 'SF-101' },
    { name: 'Rohit Sharma', phone: '+91 98765 00102', plan: 'Monthly Gold', start: dmy(addDays(today, -40)), end: dmy(addDays(today, -10)), paid: '1500', due: '500' },
    { name: 'No Phone' },
    { name: 'Copy Of Harpreet', phone: '09876500101' },
    { name: 'Existing', phone: G.athlete.phone },
    { name: 'Odd Dates', phone: '9876500103', joined: 'sometime', trainer: 'Nobody' },
  ]

  it('preview checks every row and writes nothing', async () => {
    const before = await db.athlete.count()
    const summary = await previewImport(db, rows(), G.branch.id)
    expect(summary).toMatchObject({ total: 6, create: 3, skip: 1, error: 2, activePlans: 1, expiredPlans: 1, duesPaise: 50000, dueCount: 1, newPlans: ['Monthly Gold'] })
    expect(summary.rows.find((row) => row.row === 4)?.messages[0]).toMatch(/Mobile number is missing/)
    expect(summary.rows.find((row) => row.row === 5)?.messages[0]).toMatch(/Same mobile number as row 2/)
    expect(summary.rows.find((row) => row.row === 7)?.messages.join(' ')).toMatch(/Trainer "Nobody" not found/)
    expect(await db.athlete.count()).toBe(before)
  })

  it('commit creates members, plans and dues; running it again adds nobody', async () => {
    const summary = await commitImport(db, { id: G.gym.id, name: G.gym.name, settings: {} }, rows(), G.branch.id)
    expect(summary.create).toBe(3)
    const harpreet = await db.athlete.findFirstOrThrow({ where: { phone: '+919876500101' } })
    expect(harpreet.notes).toContain('Old member ID: SF-101')
    expect(harpreet.status).toBe('NEW')
    const harpreetPlan = await db.membership.findFirstOrThrow({ where: { athleteId: harpreet.id } })
    expect(harpreetPlan).toMatchObject({ status: 'ACTIVE', pricePaise: 450000 })
    expect(iso(harpreetPlan.endsAt)).toBe(iso(addDays(today, 60)))

    const rohit = await db.athlete.findFirstOrThrow({ where: { phone: '+919876500102' } })
    expect(rohit.status).toBe('EXPIRED')
    expect(await db.membership.findFirst({ where: { athleteId: rohit.id, status: 'EXPIRED' } })).not.toBeNull()
    expect(await db.due.findFirst({ where: { athleteId: rohit.id, status: 'OPEN', amountPaise: 50000 } })).not.toBeNull()
    expect(await db.membershipPlan.findFirst({ where: { name: 'Monthly Gold', durationDays: 30 } })).not.toBeNull()
    const codes = (await db.athlete.findMany({ select: { memberCode: true } })).map((a) => a.memberCode)
    expect(new Set(codes).size).toBe(codes.length)

    const again = await commitImport(db, { id: G.gym.id, name: G.gym.name, settings: {} }, rows(), G.branch.id)
    expect(again.create).toBe(0)
    expect(await db.athlete.count({ where: { phone: '+919876500101' } })).toBe(1)
  })

  it('respects the plan member limit', async () => {
    const plan = await base.platformPlan.create({ data: { code: uniq('tiny'), name: 'Tiny', monthlyPricePaise: 100, annualPricePaise: 1000, memberLimit: 5, branchLimit: 1, whatsappQuota: 0, features: [] } })
    await db.gymSubscription.create({ data: { gymId: G.gym.id, planId: plan.id, status: 'ACTIVE', cycle: 'MONTHLY', currentPeriodStart: today, currentPeriodEnd: addDays(today, 30) } })
    const many = Array.from({ length: 4 }, (_, i) => ({ name: `Extra ${i}`, phone: `98765${String(20000 + i)}` }))
    await expect(commitImport(db, { id: G.gym.id, name: G.gym.name, settings: {} }, many, G.branch.id)).rejects.toThrow(/allows 5 members/)
    await db.gymSubscription.deleteMany({})
    await base.platformPlan.delete({ where: { id: plan.id } })
  })
})

describe('member queries (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  let trainer: { id: string; name: string }
  let other: { id: string; name: string }
  let loner: { id: string; name: string; homeBranchId: string }

  beforeAll(async () => {
    G = await makeGym(base, 'Queries')
    db = scopeToGym(base, G.gym.id)
    const role = await db.role.create({ data: { gymId: G.gym.id, key: 'TRAINER', name: 'Trainer', permissions: ['workouts.manage'], isSystem: true } })
    trainer = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Inder Pal', phone: `+9193${Math.floor(10000000 + Math.random() * 89999999)}` } })
    other = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Daniel', phone: `+9192${Math.floor(10000000 + Math.random() * 89999999)}` } })
    await db.athlete.update({ where: { id: G.athlete.id }, data: { trainerId: trainer.id } })
    loner = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'No Trainer', phone: `+9191${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R') } })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  it('validates topic and length', () => {
    expect(queryCreateSchema.safeParse({ topic: 'DIET', body: 'Please update my diet' }).success).toBe(true)
    expect(queryCreateSchema.safeParse({ topic: 'COMPLAINT', body: 'Broken bench' }).success).toBe(false)
    expect(queryCreateSchema.safeParse({ topic: 'DIET', body: 'hi' }).success).toBe(false)
  })

  it('goes to the member trainer, not to complaints; other trainers cannot answer', async () => {
    const me = { id: G.athlete.id, name: G.athlete.name, homeBranchId: G.branch.id }
    const query = await createQuery(db, { id: G.gym.id, slug: G.gym.slug }, me, { topic: 'DIET', body: 'Please update my diet plan' })
    expect(query.trainerId).toBe(trainer.id)
    expect(await db.complaint.count()).toBe(0)
    expect(await openQueryCount(db, { id: trainer.id, kind: 'TRAINER' })).toBe(1)
    expect(await openQueryCount(db, { id: other.id, kind: 'TRAINER' })).toBe(0)
    expect(await openQueryCount(db, { id: G.owner.id, kind: 'OWNER' })).toBe(1)
    const notes = await db.notification.findMany({ where: { recipientType: 'STAFF' } })
    expect(notes.map((n) => n.recipientId).sort()).toEqual([G.owner.id, trainer.id].sort())

    await expect(replyToQuery(db, { id: G.gym.id, slug: G.gym.slug }, { id: other.id, name: other.name, kind: 'TRAINER' }, query.id, { body: 'Hi', close: false })).rejects.toThrow(/another trainer/)
    await replyToQuery(db, { id: G.gym.id, slug: G.gym.slug }, { id: trainer.id, name: trainer.name, kind: 'TRAINER' }, query.id, { body: 'Updated, check Schedule', close: false })
    const [thread] = await memberQueries(db, G.athlete.id)
    expect(thread).toMatchObject({ status: 'ANSWERED', unreadForMember: true })
    expect(thread.messages.map((m) => m.author)).toEqual(['ATHLETE', 'STAFF'])
    expect(await db.notification.count({ where: { recipientType: 'ATHLETE', recipientId: G.athlete.id } })).toBe(1)

    await addMemberMessage(db, { id: G.gym.id }, me, query.id, 'Thanks! Can you add more protein?')
    expect((await db.memberQuery.findFirstOrThrow({ where: { id: query.id } })).status).toBe('OPEN')
    await replyToQuery(db, { id: G.gym.id, slug: G.gym.slug }, { id: G.owner.id, name: 'Owner', kind: 'OWNER' }, query.id, { body: '', close: true })
    expect((await db.memberQuery.findFirstOrThrow({ where: { id: query.id } })).status).toBe('CLOSED')
  })

  it('members without a trainer reach any trainer and the owner; members only see their own', async () => {
    const lonerQuery = await createQuery(db, { id: G.gym.id, slug: G.gym.slug }, loner, { topic: 'PLAN', body: 'Can I switch to quarterly?' })
    expect(lonerQuery.trainerId).toBeNull()
    const ownerView = await staffQueries(db, { id: G.owner.id, kind: 'OWNER' }, 'open')
    expect(ownerView.map((q) => q.athlete.id)).toContain(loner.id)
    // "Any trainer" queries reach every trainer.
    const otherView = await staffQueries(db, { id: other.id, kind: 'TRAINER' }, 'all')
    expect(otherView.map((q) => q.id)).toEqual([lonerQuery.id])
    const trainerView = await staffQueries(db, { id: trainer.id, kind: 'TRAINER' }, 'all')
    const mine = trainerView.find((q) => q.athlete.id === G.athlete.id)!
    expect((await memberQueries(db, loner.id)).every((q) => q.athlete.id === loner.id)).toBe(true)
    await expect(addMemberMessage(db, { id: G.gym.id }, { id: loner.id, name: loner.name }, mine.id, 'sneaky')).rejects.toThrow(/not found/)
  })
})

describe('multi-branch overview and leaderboard chase (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  let second: { id: string }

  beforeAll(async () => {
    G = await makeGym(base, 'Branches')
    db = scopeToGym(base, G.gym.id)
    second = await db.branch.create({ data: { gymId: G.gym.id, name: 'Zirakpur', entranceQrSecret: uniq('qr'), hourlyCapacity: 80 } })
    const zk = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: second.id, memberCode: uniq('M'), name: 'Zirakpur Member', phone: `+9191${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R') } })
    const now = new Date()
    await db.checkIn.createMany({
      data: [
        { gymId: G.gym.id, branchId: G.branch.id, athleteId: G.athlete.id, checkedInAt: now, method: 'MANUAL' },
        { gymId: G.gym.id, branchId: second.id, athleteId: zk.id, checkedInAt: now, method: 'MANUAL' },
        { gymId: G.gym.id, branchId: second.id, athleteId: zk.id, checkedInAt: addDays(now, -1), method: 'MANUAL' },
      ],
    })
    await db.payment.create({ data: { gymId: G.gym.id, athleteId: zk.id, amountPaise: 150000, method: 'CASH', status: 'PAID', paidAt: now } })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  it('filters the overview to one branch and compares branches', async () => {
    const all = await getOwnerOverview(G.gym.id, 90)
    const zirakpur = await getOwnerOverview(G.gym.id, 90, second.id)
    const main = await getOwnerOverview(G.gym.id, 90, G.branch.id)
    expect(all.todayCheckIns).toBe(2)
    expect(zirakpur.todayCheckIns).toBe(1)
    expect(main.todayCheckIns).toBe(1)
    expect(zirakpur.collectedThisMonthPaise).toBe(150000)
    expect(main.collectedThisMonthPaise).toBe(0)
    expect(zirakpur.floor.capacity).toBe(80)
    const cards = await getBranchComparison(G.gym.id, 90)
    expect(cards.map((c) => c.name).sort()).toEqual(['Main', 'Zirakpur'])
    expect(cards.find((c) => c.id === second.id)).toMatchObject({ todayCheckIns: 1, collectedThisMonthPaise: 150000 })
  })

  it('leaderboard tells a member who to chase', async () => {
    const board = await leaderboard(db, G.athlete.id)
    expect(board.total).toBe(2)
    expect(board.me?.rank).toBe(2)
    expect(board.chase).toMatchObject({ rank: 1, workoutsToPass: 2 })
  })
})
