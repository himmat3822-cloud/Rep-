import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { financialYearOf, formatInvoiceNumber, invoicePrefixFor, splitGst } from '@/lib/gst'
import { planCharge } from '@/lib/owner/money'
import { scopeToGym } from '@/lib/db/tenant-core'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

describe('GST maths', () => {
  it('splits inclusive prices into taxable + CGST + SGST', () => {
    const gst = splitGst(150000, 18, true)
    expect(gst.totalPaise).toBe(150000)
    expect(gst.taxablePaise).toBe(127119)
    expect(gst.cgstPaise + gst.sgstPaise).toBe(22881)
    expect(Math.abs(gst.cgstPaise - gst.sgstPaise)).toBeLessThanOrEqual(1)
    expect(gst.igstPaise).toBe(0)
  })

  it('adds GST on top for exclusive prices and supports IGST and 0%', () => {
    expect(splitGst(100000, 18, false).totalPaise).toBe(118000)
    const inter = splitGst(118000, 18, true, true)
    expect(inter.igstPaise).toBe(18000)
    expect(inter.cgstPaise).toBe(0)
    expect(splitGst(50000, 0, true)).toMatchObject({ taxablePaise: 50000, taxPaise: 0, totalPaise: 50000 })
  })

  it('uses the Indian financial year in IST and short invoice numbers', () => {
    expect(financialYearOf(new Date('2027-03-31T18:00:00Z'))).toBe('2026-27') // 31 Mar 23:30 IST
    expect(financialYearOf(new Date('2027-03-31T18:31:00Z'))).toBe('2027-28') // 1 Apr 00:01 IST
    const number = formatInvoiceNumber('FF', '2026-27', 7)
    expect(number).toBe('FF/26-27/0007')
    expect(number.length).toBeLessThanOrEqual(16)
    expect(invoicePrefixFor('Iron Temple Gym')).toBe('ITG')
  })

  it('prices a plan with joining fee, discount and exclusive GST', () => {
    const plan = { pricePaise: 150000, joiningFeePaise: 50000, gstPercent: 18, gstInclusive: true }
    expect(planCharge(plan, true, 20000)).toBe(180000)
    expect(planCharge({ ...plan, gstInclusive: false }, false, 0)).toBe(177000)
    expect(planCharge(plan, false, 999999)).toBe(0)
  })
})

describe('selling memberships, dues, freeze and limits (DB)', () => {
  const db = testDb()
  let A: Awaited<ReturnType<typeof makeGym>>
  let B: Awaited<ReturnType<typeof makeGym>>
  let planId = ''
  let ownerA = ''

  beforeAll(async () => {
    A = await makeGym(db, 'Seller')
    B = await makeGym(db, 'Other')
    ownerA = A.owner.id
    const platformPlan = await db.platformPlan.upsert({
      where: { code: 'tiny-plan' },
      create: { code: 'tiny-plan', name: 'Tiny', monthlyPricePaise: 10000, annualPricePaise: 100000, branchLimit: 1, memberLimit: 3, staffLimit: 1, trainerLimit: 1, deskLimit: 1, whatsappQuota: 10, features: [] },
      update: { memberLimit: 3 },
    })
    for (const gym of [A, B]) {
      await db.gymSubscription.create({ data: { gymId: gym.gym.id, planId: platformPlan.id, status: 'ACTIVE' } })
      await db.role.create({ data: { gymId: gym.gym.id, key: 'TRAINER', name: 'Trainer', permissions: [], isSystem: true } })
    }
    const plan = await db.membershipPlan.create({ data: { gymId: A.gym.id, name: 'Quarterly', durationDays: 90, pricePaise: 400000, joiningFeePaise: 50000, gstPercent: 18, gstInclusive: true, maxFreezeDays: 7 } })
    planId = plan.id
    await db.gym.update({ where: { id: A.gym.id }, data: { name: 'Seller Gym', settings: { invoicePrefix: 'SG' } } })
  })

  afterAll(async () => {
    await purgeGymData(db, A.gym.id)
    await purgeGymData(db, B.gym.id)
  })

  const gymInfo = () => ({ id: A.gym.id, name: 'Seller Gym', settings: { invoicePrefix: 'SG' } })

  it('sells a plan, issues sequential GST invoices and opens a due for the balance', async () => {
    const { sellMembership } = await import('@/lib/owner/money')
    const tenant = scopeToGym(db, A.gym.id)
    const first = await sellMembership(tenant, gymInfo(), { athleteId: A.athlete.id, planId, discountPaise: 0, amountPaidPaise: 450000, method: 'UPI', includeJoiningFee: true }, { staffId: ownerA })
    expect(first.invoice?.number).toMatch(/^SG\/\d{2}-\d{2}\/0001$/)
    expect(first.invoice?.totalPaise).toBe(450000)
    expect((first.invoice?.cgstPaise ?? 0) + (first.invoice?.sgstPaise ?? 0) + (first.invoice?.taxablePaise ?? 0)).toBe(450000)
    expect(first.due).toBeNull()
    const days = Math.round((first.membership.endsAt.getTime() - first.membership.startsAt.getTime()) / 86400000) + 1
    expect(days).toBe(90)

    // Renewing early: starts the day after the current plan ends; part payment leaves a due.
    const second = await sellMembership(tenant, gymInfo(), { athleteId: A.athlete.id, planId, discountPaise: 0, amountPaidPaise: 100000, method: 'CASH', includeJoiningFee: false }, { staffId: ownerA })
    expect(second.invoice?.number).toMatch(/\/0002$/)
    expect(second.membership.startsAt.getTime()).toBe(first.membership.endsAt.getTime() + 86400000)
    expect(second.membership.status).toBe('PENDING')
    expect(second.due?.amountPaise).toBe(300000)

    await expect(sellMembership(tenant, gymInfo(), { athleteId: A.athlete.id, planId, discountPaise: 0, amountPaidPaise: 999999, method: 'CASH', includeJoiningFee: false }, { staffId: ownerA })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('collects a due in parts and closes it', async () => {
    const { collectDue } = await import('@/lib/owner/money')
    const tenant = scopeToGym(db, A.gym.id)
    const due = await tenant.due.findFirstOrThrow({ where: { athleteId: A.athlete.id, status: 'OPEN' } })
    const part = await collectDue(tenant, gymInfo(), { dueId: due.id, amountPaise: 100000, method: 'UPI' }, { staffId: ownerA })
    expect(part.remainingPaise).toBe(200000)
    expect(part.invoice.number).toMatch(/\/0003$/)
    const rest = await collectDue(tenant, gymInfo(), { dueId: due.id, method: 'CASH' }, { staffId: ownerA })
    expect(rest.remainingPaise).toBe(0)
    expect((await tenant.due.findFirstOrThrow({ where: { id: due.id } })).status).toBe('PAID')
    await expect(collectDue(tenant, gymInfo(), { dueId: due.id, method: 'CASH' }, { staffId: ownerA })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('another gym cannot touch these dues and keeps its own invoice sequence', async () => {
    const { collectDue } = await import('@/lib/owner/money')
    const tenantB = scopeToGym(db, B.gym.id)
    const due = await db.due.findFirstOrThrow({ where: { gymId: A.gym.id } })
    await expect(collectDue(tenantB, { id: B.gym.id, name: 'Other Gym', settings: {} }, { dueId: due.id, method: 'CASH' }, { staffId: B.owner.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db.invoiceCounter.count({ where: { gymId: B.gym.id } })).toBe(0)
  })

  it('freezes within the plan allowance and moves the end date', async () => {
    const { freezeMembership } = await import('@/lib/owner/money')
    const tenant = scopeToGym(db, A.gym.id)
    const membership = await tenant.membership.findFirstOrThrow({ where: { athleteId: A.athlete.id, status: 'ACTIVE' } })
    const updated = await freezeMembership(tenant, A.gym.id, { membershipId: membership.id, fromDate: new Date(), days: 5, reason: 'travel' }, { staffId: ownerA })
    expect(updated.endsAt.getTime()).toBe(membership.endsAt.getTime() + 5 * 86400000)
    expect(updated.freezeDaysUsed).toBe(5)
    await expect(freezeMembership(tenant, A.gym.id, { membershipId: membership.id, fromDate: new Date(), days: 3, reason: 'again' }, { staffId: ownerA })).rejects.toThrow(/2 freeze day/)
  })

  it('enforces the plan member limit and blocks duplicate phones', async () => {
    const { createMember } = await import('@/lib/owner/members')
    const tenant = scopeToGym(db, A.gym.id)
    const base = { homeBranchId: A.branch.id, language: 'EN' as const }
    await createMember(tenant, gymInfo(), { ...base, name: 'Two', phone: `+9191${String(Date.now()).slice(-8)}` })
    await expect(createMember(tenant, gymInfo(), { ...base, name: 'Dup', phone: A.athlete.phone })).rejects.toMatchObject({ code: 'CONFLICT' })
    await createMember(tenant, gymInfo(), { ...base, name: 'Three', phone: `+9192${String(Date.now()).slice(-8)}` })
    await expect(createMember(tenant, gymInfo(), { ...base, name: 'Four', phone: `+9193${String(Date.now()).slice(-8)}` })).rejects.toThrow(/allows 3 active members/)
    // Admin override adds room.
    await db.gymOverride.upsert({ where: { gymId: A.gym.id }, create: { gymId: A.gym.id, extraMembers: 1 }, update: { extraMembers: 1 } })
    const four = await createMember(tenant, gymInfo(), { ...base, name: 'Four', phone: `+9194${String(Date.now()).slice(-8)}`, emergencyContact: 'Mom 98765' })
    expect(four.memberCode).toMatch(/^SG\d{4}$/)
    expect(four.emergencyContactEnc).not.toContain('Mom')
  })

  it('staff limit blocks a second trainer', async () => {
    const { assertCanAdd } = await import('@/lib/owner/limits')
    const tenant = scopeToGym(db, A.gym.id)
    await expect(assertCanAdd(tenant, 'trainer')).resolves.toBeTruthy()
    const role = await db.role.findFirstOrThrow({ where: { gymId: A.gym.id, key: 'TRAINER' } })
    await db.gymUser.create({ data: { gymId: A.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Coach', phone: `+9195${uniq('x').slice(-8).replace(/\D/g, '1').padStart(8, '1')}` } })
    await expect(assertCanAdd(tenant, 'trainer')).rejects.toThrow(/allows 1 staff/)
  })
})
