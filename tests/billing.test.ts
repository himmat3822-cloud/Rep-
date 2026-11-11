import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addMonthsUtc, adminRestore, adminSuspend, applyPayment, evaluateBilling, extendTrial, priceFor, type BillingSnapshot } from '@/lib/platform/billing'
import { verifyRazorpaySignature } from '@/lib/integrations/razorpay'
import { toCsv } from '@/lib/csv'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

const DAY = 24 * 3600 * 1000
const T0 = new Date('2026-06-01T00:00:00Z')
const at = (days: number) => new Date(T0.getTime() + days * DAY)

function snap(overrides: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    status: 'TRIAL',
    cycle: 'MONTHLY',
    trialEndsAt: at(14),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextDueAt: at(14),
    pastDueSince: null,
    suspendedAt: null,
    dataPurgeAfter: null,
    manualOverride: false,
    cancelAtPeriodEnd: false,
    freeMonthsLeft: 0,
    ...overrides,
  }
}

describe('subscription state machine', () => {
  it('stays on TRIAL until the trial ends, then goes PAST_DUE', () => {
    expect(evaluateBilling(snap(), at(13)).changed).toBe(false)
    const result = evaluateBilling(snap(), at(14.5))
    expect(result.next.status).toBe('PAST_DUE')
    expect(result.next.pastDueSince).toEqual(at(14))
    expect(result.events).toEqual(['trial_ended'])
  })

  it('PAST_DUE -> READ_ONLY after the 3-day grace -> SUSPENDED 15 days after due', () => {
    const pastDue = snap({ status: 'PAST_DUE', pastDueSince: at(14) })
    expect(evaluateBilling(pastDue, at(16.9)).next.status).toBe('PAST_DUE')
    expect(evaluateBilling(pastDue, at(17)).next.status).toBe('READ_ONLY')
    expect(evaluateBilling(snap({ status: 'READ_ONLY', pastDueSince: at(14) }), at(28.9)).next.status).toBe('READ_ONLY')
    const suspended = evaluateBilling(snap({ status: 'READ_ONLY', pastDueSince: at(14) }), at(29)).next
    expect(suspended.status).toBe('SUSPENDED')
    expect(suspended.suspendedAt).toEqual(at(29))
    expect(suspended.dataPurgeAfter).toEqual(at(29 + 90))
  })

  it('catches up several steps when the cron missed days', () => {
    const result = evaluateBilling(snap(), at(40))
    expect(result.events).toEqual(['trial_ended', 'read_only', 'suspended'])
    expect(result.next.status).toBe('SUSPENDED')
  })

  it('ACTIVE goes PAST_DUE on the due date', () => {
    const active = snap({ status: 'ACTIVE', currentPeriodStart: at(14), currentPeriodEnd: at(44), nextDueAt: at(44) })
    expect(evaluateBilling(active, at(43)).changed).toBe(false)
    expect(evaluateBilling(active, at(44)).next.status).toBe('PAST_DUE')
  })

  it('uses free months instead of going PAST_DUE', () => {
    const result = evaluateBilling(snap({ freeMonthsLeft: 2 }), at(14))
    expect(result.next.status).toBe('ACTIVE')
    expect(result.next.freeMonthsLeft).toBe(1)
    expect(result.next.nextDueAt).toEqual(addMonthsUtc(at(14), 1))
    const later = evaluateBilling(result.next, addMonthsUtc(at(14), 2))
    expect(later.events).toEqual(['free_month_used', 'past_due'])
    expect(later.next.freeMonthsLeft).toBe(0)
  })

  it('cancel at period end ends as CANCELLED, not PAST_DUE', () => {
    const active = snap({ status: 'ACTIVE', currentPeriodEnd: at(44), nextDueAt: at(44), cancelAtPeriodEnd: true })
    const result = evaluateBilling(active, at(45))
    expect(result.next.status).toBe('CANCELLED')
    expect(result.events).toEqual(['cancelled'])
  })

  it('never undoes an admin decision (manualOverride)', () => {
    const revoked = adminSuspend(snap({ status: 'ACTIVE', nextDueAt: at(100) }), at(20))
    expect(revoked.status).toBe('SUSPENDED')
    expect(evaluateBilling(revoked, at(50)).changed).toBe(false)
    const goodwill = adminRestore(snap({ status: 'READ_ONLY', pastDueSince: at(14) }), at(20))
    expect(goodwill.status).toBe('ACTIVE')
    expect(goodwill.manualOverride).toBe(true)
    expect(evaluateBilling(goodwill, at(60)).changed).toBe(false)
  })

  it('flags purge after the 90-day retention', () => {
    const suspended = snap({ status: 'SUSPENDED', suspendedAt: at(29), dataPurgeAfter: at(119) })
    expect(evaluateBilling(suspended, at(118)).events).toEqual([])
    expect(evaluateBilling(suspended, at(119)).events).toEqual(['purge_due'])
  })

  it('a payment restores the gym from any state', () => {
    for (const status of ['PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'] as const) {
      const paid = applyPayment(snap({ status, pastDueSince: at(14), suspendedAt: at(29), dataPurgeAfter: at(119), manualOverride: true }), at(30))
      expect(paid.status).toBe('ACTIVE')
      expect(paid.currentPeriodStart).toEqual(at(30))
      expect(paid.nextDueAt).toEqual(addMonthsUtc(at(30), 1))
      expect(paid.pastDueSince).toBeNull()
      expect(paid.dataPurgeAfter).toBeNull()
      expect(paid.manualOverride).toBe(false)
    }
  })

  it('paying early extends from the period end; paying in trial starts after the trial', () => {
    const active = snap({ status: 'ACTIVE', currentPeriodStart: at(14), currentPeriodEnd: at(44), nextDueAt: at(44) })
    expect(applyPayment(active, at(40)).currentPeriodStart).toEqual(at(44))
    expect(applyPayment(snap(), at(5)).currentPeriodStart).toEqual(at(14))
    expect(applyPayment(snap(), at(5), 'ANNUAL').currentPeriodEnd).toEqual(addMonthsUtc(at(14), 12))
  })

  it('extending a trial resets an unpaid gym to TRIAL', () => {
    const extended = extendTrial(snap({ status: 'READ_ONLY', pastDueSince: at(14) }), 7, at(20))
    expect(extended.status).toBe('TRIAL')
    expect(extended.trialEndsAt).toEqual(at(27))
    expect(evaluateBilling(extended, at(26)).changed).toBe(false)
  })

  it('handles month ends correctly', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addMonthsUtc(new Date('2026-03-15T10:00:00Z'), 12).toISOString()).toBe('2027-03-15T10:00:00.000Z')
  })
})

describe('pricing', () => {
  const elite = { monthlyPricePaise: 299900, annualPricePaise: 2999000, branchLimit: 3, extraBranchPaise: 79900 }

  it('charges extra branches and adds 18% GST', () => {
    const price = priceFor({ ...elite, cycle: 'MONTHLY', branchCount: 5 })
    expect(price.extraBranches).toBe(2)
    expect(price.subtotalPaise).toBe(299900 + 2 * 79900)
    expect(price.gstPaise).toBe(Math.round(price.subtotalPaise * 0.18))
    expect(price.monthlyEquivalentPaise).toBe(price.subtotalPaise)
  })

  it('annual = 10 months, extra branches too; free branches and custom price respected', () => {
    const annual = priceFor({ ...elite, cycle: 'ANNUAL', branchCount: 4 })
    expect(annual.subtotalPaise).toBe(2999000 + 79900 * 10)
    expect(annual.monthlyEquivalentPaise).toBe(Math.round(annual.subtotalPaise / 12))
    expect(priceFor({ ...elite, cycle: 'MONTHLY', branchCount: 4, extraBranchesGranted: 1 }).extraBranches).toBe(0)
    expect(priceFor({ ...elite, cycle: 'MONTHLY', branchCount: 1, customPricePaise: 199900 }).subtotalPaise).toBe(199900)
    expect(priceFor({ monthlyPricePaise: 79900, annualPricePaise: 799000, branchLimit: 1, extraBranchPaise: null, cycle: 'MONTHLY', branchCount: 3 }).extraBranches).toBe(0)
  })
})

describe('webhook signature + CSV safety', () => {
  it('verifies Razorpay HMAC signatures', () => {
    const body = '{"event":"subscription.charged"}'
    const good = createHmac('sha256', 'whsec').update(body).digest('hex')
    expect(verifyRazorpaySignature(body, good, 'whsec')).toBe(true)
    expect(verifyRazorpaySignature(`${body} `, good, 'whsec')).toBe(false)
    expect(verifyRazorpaySignature(body, good, 'other')).toBe(false)
    expect(verifyRazorpaySignature(body, null, 'whsec')).toBe(false)
    expect(verifyRazorpaySignature(body, 'zz', 'whsec')).toBe(false)
  })

  it('neutralises spreadsheet formulas and escapes quotes', () => {
    const csv = toCsv([{ name: '=HYPERLINK("x")', note: 'a, "b"' }], [
      { header: 'Name', value: (r) => r.name },
      { header: 'Note', value: (r) => r.note },
    ])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"a, ""b"""')
  })
})

describe('billing with the database', () => {
  const db = testDb()
  let gym: Awaited<ReturnType<typeof makeGym>>

  beforeAll(async () => {
    gym = await makeGym(db, 'Billing')
    const plan = await db.platformPlan.upsert({
      where: { code: 'test-plan' },
      create: { code: 'test-plan', name: 'Test', monthlyPricePaise: 100000, annualPricePaise: 1000000, branchLimit: 1, whatsappQuota: 100, features: ['qr_attendance'] },
      update: {},
    })
    await db.gymSubscription.create({ data: { gymId: gym.gym.id, planId: plan.id, status: 'TRIAL', trialEndsAt: new Date(Date.now() - 5 * DAY), nextDueAt: new Date(Date.now() - 5 * DAY) } })
    await db.gym.update({ where: { id: gym.gym.id }, data: { subscriptionStatus: 'TRIAL' } })
  })

  afterAll(async () => {
    await purgeGymData(db, gym.gym.id)
  })

  it('cron moves an expired trial to READ_ONLY and keeps Gym.subscriptionStatus in sync', async () => {
    const { runBillingCycle } = await import('@/lib/platform/billing-service')
    const summary = await runBillingCycle(db)
    const mine = summary.transitions.find((t) => t.gymId === gym.gym.id)
    expect(mine?.to).toBe('READ_ONLY')
    const [sub, row] = await Promise.all([db.gymSubscription.findUnique({ where: { gymId: gym.gym.id } }), db.gym.findUnique({ where: { id: gym.gym.id } })])
    expect(sub?.status).toBe('READ_ONLY')
    expect(row?.subscriptionStatus).toBe('READ_ONLY')
    const notes = await db.notification.count({ where: { gymId: gym.gym.id, recipientId: gym.owner.id } })
    expect(notes).toBeGreaterThan(0)
  })

  it('Razorpay subscription.charged restores the gym once, even if delivered twice', async () => {
    const { processRazorpayEvent } = await import('@/lib/platform/razorpay-webhook')
    const subId = uniq('sub')
    const paymentId = uniq('pay')
    const eventId = uniq('evt')
    const body = {
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: subId, notes: { gymId: gym.gym.id } } },
        payment: { entity: { id: paymentId, amount: 118000, currency: 'INR', created_at: Math.floor(Date.now() / 1000) } },
      },
    }
    expect(await processRazorpayEvent(db, eventId, body)).toBe('processed')
    expect(await processRazorpayEvent(db, eventId, body)).toBe('duplicate')
    // Same payment arriving under a different event id is still not double-counted.
    expect(await processRazorpayEvent(db, uniq('evt'), body)).toBe('processed')

    const sub = await db.gymSubscription.findUnique({ where: { gymId: gym.gym.id }, include: { invoices: true } })
    expect(sub?.status).toBe('ACTIVE')
    expect(sub?.razorpaySubscriptionId).toBe(subId)
    expect(sub?.invoices).toHaveLength(1)
    expect((sub?.invoices[0]?.amountPaise ?? 0) + (sub?.invoices[0]?.gstPaise ?? 0)).toBe(118000)
    expect((await db.gym.findUnique({ where: { id: gym.gym.id } }))?.subscriptionStatus).toBe('ACTIVE')
    const audit = await db.auditLog.findFirst({ where: { gymId: gym.gym.id, action: 'billing.restored_by_payment' } })
    expect(audit).not.toBeNull()
  })

  it('admin revoke holds even after the cron runs; restore brings it back', async () => {
    const { adminBillingAction, runBillingCycle } = await import('@/lib/platform/billing-service')
    const admin = await db.adminUser.upsert({ where: { adminId: 'test-admin' }, create: { adminId: 'test-admin', name: 'Test', passwordHash: 'x' }, update: {} })
    await adminBillingAction(db, gym.gym.id, { kind: 'suspend' }, { adminUserId: admin.id, reason: 'testing revoke' })
    await runBillingCycle(db)
    expect((await db.gym.findUnique({ where: { id: gym.gym.id } }))?.subscriptionStatus).toBe('SUSPENDED')
    const restored = await adminBillingAction(db, gym.gym.id, { kind: 'restore' }, { adminUserId: admin.id, reason: 'testing restore' })
    expect(restored.to).toBe('ACTIVE')
    const log = await db.auditLog.findMany({ where: { gymId: gym.gym.id, action: { in: ['gym.suspend', 'gym.restore'] } } })
    expect(log.map((row) => row.reason).sort()).toEqual(['testing restore', 'testing revoke'])
  })
})
