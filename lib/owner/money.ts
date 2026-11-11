import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { audit } from '@/lib/audit'
import type { AuditInput } from '@/lib/audit-core'
import { financialYearOf, formatInvoiceNumber, GYM_SAC_CODE, invoicePrefixFor, splitGst } from '@/lib/gst'
import { parseGymSettings } from '@/lib/gym/settings'
import { addDays, istDateOnly } from '@/lib/time'

// Selling memberships, collecting dues and freezing plans.
// Every function runs inside ONE tenant transaction so a membership, its
// payment, its GST invoice and any remaining due are created together.

type Tx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0]
const DAY_MS = 24 * 3600 * 1000

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK'

export interface Actor {
  staffId: string
  impersonatedBy?: string | null
  ip?: string | null
}

async function issueInvoice(tx: Tx, gym: { id: string; name: string; settings: unknown }, input: { athleteId: string; paymentId: string; amountPaise: number; gstPercent: number; description: string; paidAt: Date }) {
  const fy = financialYearOf(input.paidAt)
  const counter = await tx.invoiceCounter.upsert({
    where: { gymId_financialYear: { gymId: gym.id, financialYear: fy } },
    create: { gymId: gym.id, financialYear: fy, lastSequence: 1 },
    update: { lastSequence: { increment: 1 } },
  })
  const prefix = parseGymSettings(gym.settings).invoicePrefix ?? invoicePrefixFor(gym.name)
  // Amounts collected are always GST-inclusive (the price the member pays).
  const gst = splitGst(input.amountPaise, input.gstPercent, true)
  return tx.invoice.create({
    data: {
      gymId: gym.id,
      athleteId: input.athleteId,
      paymentId: input.paymentId,
      number: formatInvoiceNumber(prefix, fy, counter.lastSequence),
      financialYear: fy,
      sequence: counter.lastSequence,
      taxablePaise: gst.taxablePaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      totalPaise: gst.totalPaise,
      lineItems: [{ description: input.description, sac: GYM_SAC_CODE, gstPercent: input.gstPercent, amountPaise: input.amountPaise }],
      issuedAt: input.paidAt,
    },
  })
}

// ---------------------------------------------------------------------------
// Sell or renew a membership
// ---------------------------------------------------------------------------

export interface SellInput {
  athleteId: string
  planId: string
  startsOn?: Date | null
  discountPaise: number
  amountPaidPaise: number
  method: PaymentMethod
  includeJoiningFee: boolean
  note?: string
}

// Price the member pays for a plan (GST added on top for exclusive plans).
export function planCharge(plan: { pricePaise: number; joiningFeePaise: number; gstPercent: number; gstInclusive: boolean }, includeJoiningFee: boolean, discountPaise: number) {
  const base = plan.pricePaise + (includeJoiningFee ? plan.joiningFeePaise : 0)
  const afterDiscount = Math.max(0, base - Math.max(0, discountPaise))
  return plan.gstInclusive ? afterDiscount : splitGst(afterDiscount, plan.gstPercent, false).totalPaise
}

export async function sellMembership(db: TenantDb, gym: { id: string; name: string; settings: unknown }, input: SellInput, actor: Actor) {
  const result = await db.$transaction(async (tx) => {
    const [athlete, plan] = await Promise.all([
      tx.athlete.findFirst({ where: { id: input.athleteId, archived: false } }),
      tx.membershipPlan.findFirst({ where: { id: input.planId, active: true } }),
    ])
    if (!athlete) throw new ApiError(404, 'NOT_FOUND', 'Member not found')
    if (!plan) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an active membership plan')

    const today = istDateOnly()
    const current = await tx.membership.findFirst({ where: { athleteId: athlete.id, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' } })
    // Renewing early: the new plan starts the day after the current one ends.
    let startsAt = input.startsOn ? istDateOnly(input.startsOn) : today
    if (current && current.endsAt >= startsAt) startsAt = new Date(current.endsAt.getTime() + DAY_MS)
    const endsAt = new Date(startsAt.getTime() + (plan.durationDays - 1) * DAY_MS)

    const charge = planCharge(plan, input.includeJoiningFee, input.discountPaise)
    if (input.amountPaidPaise > charge) throw new ApiError(422, 'VALIDATION_ERROR', 'Amount paid is more than the plan total')

    const membership = await tx.membership.create({
      data: {
        gymId: gym.id,
        athleteId: athlete.id,
        planId: plan.id,
        status: startsAt.getTime() > today.getTime() ? 'PENDING' : 'ACTIVE',
        startsAt,
        endsAt,
        pricePaise: charge,
        discountPaise: Math.max(0, input.discountPaise),
        ptSessionsLeft: plan.ptSessionsIncluded,
      },
    })

    const paidAt = new Date()
    let payment = null
    let invoice = null
    if (input.amountPaidPaise > 0) {
      payment = await tx.payment.create({
        data: { gymId: gym.id, athleteId: athlete.id, membershipId: membership.id, amountPaise: input.amountPaidPaise, method: input.method, status: 'PAID', collectedById: actor.staffId, note: input.note ?? '', paidAt },
      })
      invoice = await issueInvoice(tx, gym, {
        athleteId: athlete.id,
        paymentId: payment.id,
        amountPaise: input.amountPaidPaise,
        gstPercent: plan.gstPercent,
        description: `${plan.name} membership (${plan.durationDays} days)${input.includeJoiningFee && plan.joiningFeePaise ? ' incl. joining fee' : ''}`,
        paidAt,
      })
    }

    const remaining = charge - input.amountPaidPaise
    const due = remaining > 0
      ? await tx.due.create({ data: { gymId: gym.id, athleteId: athlete.id, membershipId: membership.id, amountPaise: remaining, dueDate: addDays(today, 7), status: 'OPEN' } })
      : null

    if (athlete.status === 'EXPIRED') await tx.athlete.update({ where: { id: athlete.id }, data: { status: 'NEW', statusComputedAt: new Date() } })

    // Refer a friend: the first paid membership of a referred member gives
    // the referrer free days on their running (or next) plan.
    let referral: { referrerId: string; friend: string; days: number } | null = null
    if (payment && athlete.referredById) {
      const days = parseGymSettings(gym.settings).referralRewardDays
      const already = await tx.referral.findFirst({ where: { referredAthleteId: athlete.id } })
      if (!already && days > 0) {
        const target = await tx.membership.findFirst({ where: { athleteId: athlete.referredById, status: { in: ['ACTIVE', 'PENDING', 'FROZEN'] }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' } })
        if (target) await tx.membership.update({ where: { id: target.id }, data: { endsAt: new Date(target.endsAt.getTime() + days * DAY_MS) } })
        await tx.referral.create({ data: { gymId: gym.id, referrerId: athlete.referredById, referredAthleteId: athlete.id, rewardDays: days, rewardedAt: target ? new Date() : null } })
        await tx.lead.updateMany({ where: { phone: athlete.phone, referrerId: athlete.referredById }, data: { stage: 'JOINED', convertedAthleteId: athlete.id } })
        referral = { referrerId: athlete.referredById, friend: athlete.name, days }
      }
    }

    const auditEntry: AuditInput = {
      gymId: gym.id,
      actorType: actor.impersonatedBy ? 'ADMIN' : 'STAFF',
      actorId: actor.impersonatedBy ?? actor.staffId,
      impersonatedBy: actor.impersonatedBy ?? null,
      action: 'membership.sell',
      entity: 'Membership',
      entityId: membership.id,
      meta: { athleteId: athlete.id, plan: plan.name, chargePaise: charge, paidPaise: input.amountPaidPaise, method: input.method, invoice: invoice?.number ?? null, duePaise: remaining },
      ip: actor.ip ?? null,
    }
    return { membership, payment, invoice, due, auditEntry, referral }
  })
  await audit(result.auditEntry)
  const { auditEntry: _entry, ...rest } = result
  void _entry
  return rest
}

// ---------------------------------------------------------------------------
// Collect an open due (full or part)
// ---------------------------------------------------------------------------

export async function collectDue(db: TenantDb, gym: { id: string; name: string; settings: unknown }, input: { dueId: string; amountPaise?: number; method: PaymentMethod; note?: string }, actor: Actor) {
  const result = await db.$transaction(async (tx) => {
    const due = await tx.due.findFirst({ where: { id: input.dueId, status: 'OPEN' } })
    if (!due) throw new ApiError(404, 'NOT_FOUND', 'This due is already settled')
    const amount = input.amountPaise ?? due.amountPaise
    if (amount <= 0 || amount > due.amountPaise) throw new ApiError(422, 'VALIDATION_ERROR', 'Amount must be between Rs 1 and the amount due')

    const membership = due.membershipId ? await tx.membership.findFirst({ where: { id: due.membershipId } }) : null
    const plan = membership ? await tx.membershipPlan.findFirst({ where: { id: membership.planId } }) : null
    const paidAt = new Date()
    const payment = await tx.payment.create({
      data: { gymId: gym.id, athleteId: due.athleteId, membershipId: due.membershipId, dueId: due.id, amountPaise: amount, method: input.method, status: 'PAID', collectedById: actor.staffId, note: input.note ?? '', paidAt },
    })
    const invoice = await issueInvoice(tx, gym, {
      athleteId: due.athleteId,
      paymentId: payment.id,
      amountPaise: amount,
      gstPercent: plan?.gstPercent ?? 18,
      description: plan ? `${plan.name} membership - balance payment` : 'Membership dues',
      paidAt,
    })
    const left = due.amountPaise - amount
    await tx.due.update({ where: { id: due.id }, data: left === 0 ? { status: 'PAID', paidAt, amountPaise: due.amountPaise } : { amountPaise: left } })
    const auditEntry: AuditInput = {
      gymId: gym.id,
      actorType: actor.impersonatedBy ? 'ADMIN' : 'STAFF',
      actorId: actor.impersonatedBy ?? actor.staffId,
      impersonatedBy: actor.impersonatedBy ?? null,
      action: 'due.collect',
      entity: 'Due',
      entityId: due.id,
      meta: { athleteId: due.athleteId, paidPaise: amount, remainingPaise: left, method: input.method, invoice: invoice.number },
      ip: actor.ip ?? null,
    }
    return { payment, invoice, remainingPaise: left, auditEntry }
  })
  await audit(result.auditEntry)
  const { auditEntry: _entry, ...rest } = result
  void _entry
  return rest
}

export async function waiveDue(db: TenantDb, gymId: string, dueId: string, reason: string, actor: Actor) {
  const due = await db.due.findFirst({ where: { id: dueId, status: 'OPEN' } })
  if (!due) throw new ApiError(404, 'NOT_FOUND', 'This due is already settled')
  await db.due.update({ where: { id: due.id }, data: { status: 'WAIVED' } })
  await audit({ gymId, actorType: 'STAFF', actorId: actor.staffId, impersonatedBy: actor.impersonatedBy ?? null, action: 'due.waive', entity: 'Due', entityId: due.id, reason, meta: { amountPaise: due.amountPaise }, ip: actor.ip ?? null })
}

// ---------------------------------------------------------------------------
// Freeze: plan expiry shifts by the frozen days, within the plan allowance
// ---------------------------------------------------------------------------

export async function freezeMembership(db: TenantDb, gymId: string, input: { membershipId: string; fromDate: Date; days: number; reason: string }, actor: Actor) {
  const result = await db.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({ where: { id: input.membershipId, status: { in: ['ACTIVE', 'PENDING'] } } })
    if (!membership) throw new ApiError(404, 'NOT_FOUND', 'No active membership to freeze')
    const plan = await tx.membershipPlan.findFirst({ where: { id: membership.planId } })
    const allowance = (plan?.maxFreezeDays ?? 0) - membership.freezeDaysUsed
    if (input.days > allowance) throw new ApiError(422, 'VALIDATION_ERROR', allowance > 0 ? `Only ${allowance} freeze day(s) left on this plan` : 'This plan does not allow freezing')
    const from = istDateOnly(input.fromDate)
    if (from > membership.endsAt) throw new ApiError(422, 'VALIDATION_ERROR', 'Freeze must start before the plan ends')
    const until = new Date(from.getTime() + (input.days - 1) * DAY_MS)
    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: { frozenFrom: from, frozenUntil: until, freezeDaysUsed: { increment: input.days }, endsAt: new Date(membership.endsAt.getTime() + input.days * DAY_MS) },
    })
    if (from <= istDateOnly()) await tx.athlete.update({ where: { id: membership.athleteId }, data: { status: 'FROZEN', statusComputedAt: new Date() } })
    const auditEntry: AuditInput = { gymId, actorType: 'STAFF', actorId: actor.staffId, impersonatedBy: actor.impersonatedBy ?? null, action: 'membership.freeze', entity: 'Membership', entityId: membership.id, reason: input.reason, meta: { days: input.days, from: from.toISOString(), newEndsAt: updated.endsAt.toISOString() }, ip: actor.ip ?? null }
    return { updated, auditEntry }
  })
  await audit(result.auditEntry)
  return result.updated
}
