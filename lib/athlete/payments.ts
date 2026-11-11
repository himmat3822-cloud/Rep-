import { Prisma } from '@/lib/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { parseGymSettings } from '@/lib/gym/settings'
import { collectDue, freezeMembership, planCharge, sellMembership, type Actor } from '@/lib/owner/money'
import { formatInr } from '@/lib/money'
import { translate, type Lang } from '@/lib/i18n'
import { formatIstDate, istDateOnly, addDays } from '@/lib/time'
import { notifyAthlete, notifyStaff } from './notify'

// Member-side money flows without a payment gateway:
//  - "I've paid": member pays by UPI to the gym, enters the UPI reference;
//    the desk checks the bank app and confirms -> payment + GST invoice are
//    recorded exactly like a desk collection
//  - renew early: same claim flow for a new plan, with the owner's early
//    renewal discount
//  - freeze requests: the owner approves, the plan end date moves

export const UTR_PATTERN = /^[A-Za-z0-9]{6,30}$/

// ---------------------------------------------------------------------------
// Renewal pricing
// ---------------------------------------------------------------------------

export async function currentMembership(db: TenantDb, athleteId: string) {
  const today = istDateOnly()
  return db.membership.findFirst({ where: { athleteId, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' } })
}

// Early = the member still has a running plan when they renew.
export function renewalQuote(plan: { pricePaise: number; joiningFeePaise: number; gstPercent: number; gstInclusive: boolean }, discountPct: number, early: boolean) {
  const discountPaise = early && discountPct > 0 ? Math.round((plan.pricePaise * discountPct) / 100) : 0
  return { discountPaise, totalPaise: planCharge(plan, false, discountPaise) }
}

export async function renewalOptions(db: TenantDb, athleteId: string, settings: unknown) {
  const [plans, current] = await Promise.all([db.membershipPlan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }), currentMembership(db, athleteId)])
  const pct = parseGymSettings(settings).renewEarlyDiscountPct
  const early = Boolean(current)
  return {
    early,
    discountPct: early ? pct : 0,
    plans: plans.map((plan) => ({ id: plan.id, name: plan.name, durationDays: plan.durationDays, pricePaise: plan.pricePaise, ...renewalQuote(plan, pct, early) })),
  }
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface ClaimInput {
  kind: 'DUE' | 'RENEWAL'
  dueId?: string
  planId?: string
  amountPaise: number
  utr: string
  note?: string
}

function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function submitClaim(db: TenantDb, gym: { id: string; name: string; settings: unknown }, athlete: { id: string; name: string }, input: ClaimInput) {
  const utr = input.utr.trim().toUpperCase()
  if (!UTR_PATTERN.test(utr)) throw new ApiError(422, 'VALIDATION_ERROR', 'Enter the UPI reference number from your payment app')
  if (input.amountPaise <= 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Enter the amount you paid')

  let discountPaise = 0
  if (input.kind === 'DUE') {
    const due = await db.due.findFirst({ where: { id: input.dueId, athleteId: athlete.id, status: 'OPEN' } })
    if (!due) throw new ApiError(404, 'NOT_FOUND', 'This due is already paid or was removed')
    if (input.amountPaise > due.amountPaise) throw new ApiError(422, 'VALIDATION_ERROR', `The due is only ${formatInr(due.amountPaise)}`)
    const pending = await db.memberPaymentClaim.findFirst({ where: { dueId: due.id, status: 'PENDING' } })
    if (pending) throw new ApiError(409, 'CONFLICT', 'You already told the gym about a payment for this due. The desk will confirm it soon.')
  } else {
    const plan = await db.membershipPlan.findFirst({ where: { id: input.planId, active: true } })
    if (!plan) throw new ApiError(404, 'NOT_FOUND', 'Plan not found')
    const options = await renewalOptions(db, athlete.id, gym.settings)
    const quote = options.plans.find((p) => p.id === plan.id)!
    discountPaise = quote.discountPaise
    if (input.amountPaise > quote.totalPaise) throw new ApiError(422, 'VALIDATION_ERROR', `${plan.name} costs ${formatInr(quote.totalPaise)}`)
    const pending = await db.memberPaymentClaim.findFirst({ where: { athleteId: athlete.id, kind: 'RENEWAL', status: 'PENDING' } })
    if (pending) throw new ApiError(409, 'CONFLICT', 'A renewal payment is already waiting for the desk to confirm.')
  }

  try {
    const claim = await db.memberPaymentClaim.create({
      data: { gymId: gym.id, athleteId: athlete.id, kind: input.kind, dueId: input.kind === 'DUE' ? input.dueId : null, planId: input.kind === 'RENEWAL' ? input.planId : null, discountPaise, amountPaise: input.amountPaise, utr, note: input.note?.trim() ?? '' },
    })
    await notifyStaff(db, gym.id, { title: `${athlete.name} says they paid ${formatInr(input.amountPaise)}`, body: `UPI ref ${utr}. Check your bank app and confirm.`, href: '/owner/payments?tab=claims' })
    return claim
  } catch (error) {
    if (isUniqueError(error)) throw new ApiError(409, 'CONFLICT', 'This UPI reference was already used. Check the number in your payment app.')
    throw error
  }
}

export async function approveClaim(db: TenantDb, gym: { id: string; slug: string; name: string; settings: unknown }, claimId: string, actor: Actor) {
  const claim = await db.memberPaymentClaim.findFirst({ where: { id: claimId } })
  if (!claim) throw new ApiError(404, 'NOT_FOUND', 'Claim not found')
  if (claim.status !== 'PENDING') throw new ApiError(409, 'CONFLICT', 'This claim was already handled')
  // Lock the claim first so two people confirming at once cannot double-record it.
  const locked = await db.memberPaymentClaim.updateMany({ where: { id: claim.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: actor.staffId, decidedAt: new Date() } })
  if (locked.count === 0) throw new ApiError(409, 'CONFLICT', 'This claim was already handled')

  try {
    const note = `UPI ref ${claim.utr} (confirmed from member claim)`
    let paymentId: string | null = null
    let invoiceNumber = ''
    if (claim.kind === 'DUE') {
      const result = await collectDue(db, gym, { dueId: claim.dueId!, amountPaise: claim.amountPaise, method: 'UPI', note }, actor)
      paymentId = result.invoice.paymentId
      invoiceNumber = result.invoice.number
    } else {
      const result = await sellMembership(db, gym, { athleteId: claim.athleteId, planId: claim.planId!, discountPaise: claim.discountPaise, amountPaidPaise: claim.amountPaise, method: 'UPI', includeJoiningFee: false, note }, actor)
      paymentId = result.payment?.id ?? null
      invoiceNumber = result.invoice?.number ?? ''
      await notifyReferral(db, gym, result.referral)
    }
    await db.memberPaymentClaim.update({ where: { id: claim.id }, data: { paymentId } })
    const athlete = await db.athlete.findFirst({ where: { id: claim.athleteId }, select: { language: true } })
    const lang = (athlete?.language ?? 'EN') as Lang
    await notifyAthlete(db, gym, claim.athleteId, {
      title: translate(lang, 'notif', 'claimApproved'),
      body: translate(lang, 'notif', 'claimApprovedBody', { gym: gym.name, amount: formatInr(claim.amountPaise), invoice: invoiceNumber }),
      path: '/pay',
      tag: 'claim',
    })
    return { ok: true, invoiceNumber }
  } catch (error) {
    // Recording failed (e.g. the due was paid at the desk meanwhile): reopen.
    await db.memberPaymentClaim.update({ where: { id: claim.id }, data: { status: 'PENDING', decidedById: null, decidedAt: null } })
    throw error
  }
}

export async function rejectClaim(db: TenantDb, gym: { id: string; slug: string; name: string }, claimId: string, reason: string, actor: Actor) {
  const claim = await db.memberPaymentClaim.findFirst({ where: { id: claimId, status: 'PENDING' } })
  if (!claim) throw new ApiError(404, 'NOT_FOUND', 'Claim not found or already handled')
  await db.memberPaymentClaim.update({ where: { id: claim.id }, data: { status: 'REJECTED', decision: reason, decidedById: actor.staffId, decidedAt: new Date() } })
  const athlete = await db.athlete.findFirst({ where: { id: claim.athleteId }, select: { language: true } })
  const lang = (athlete?.language ?? 'EN') as Lang
  await notifyAthlete(db, gym, claim.athleteId, {
    title: translate(lang, 'notif', 'claimRejected'),
    body: translate(lang, 'notif', 'claimRejectedBody', { gym: gym.name, amount: formatInr(claim.amountPaise), reason }),
    path: '/pay',
    tag: 'claim',
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Freeze requests
// ---------------------------------------------------------------------------

export async function freezeAllowance(db: TenantDb, athleteId: string) {
  const membership = await db.membership.findFirst({ where: { athleteId, status: { in: ['ACTIVE', 'PENDING'] }, endsAt: { gte: istDateOnly() } }, orderBy: { endsAt: 'desc' } })
  if (!membership) return { membership: null, daysLeft: 0 }
  const plan = await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { maxFreezeDays: true } })
  return { membership, daysLeft: Math.max(0, (plan?.maxFreezeDays ?? 0) - membership.freezeDaysUsed) }
}

export async function requestFreeze(db: TenantDb, gymId: string, athlete: { id: string; name: string }, input: { fromDate: Date; days: number; reason: string }) {
  const { membership, daysLeft } = await freezeAllowance(db, athlete.id)
  if (!membership) throw new ApiError(422, 'VALIDATION_ERROR', 'You need a running plan to freeze it')
  if (daysLeft <= 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Your plan does not have freeze days left')
  if (input.days < 1 || input.days > daysLeft) throw new ApiError(422, 'VALIDATION_ERROR', `You can freeze up to ${daysLeft} days`)
  const from = istDateOnly(input.fromDate)
  const today = istDateOnly()
  if (from < today || from > addDays(today, 30)) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a start date in the next 30 days')
  if (from > membership.endsAt) throw new ApiError(422, 'VALIDATION_ERROR', 'The freeze must start before your plan ends')
  const pending = await db.freezeRequest.findFirst({ where: { athleteId: athlete.id, status: 'PENDING' } })
  if (pending) throw new ApiError(409, 'CONFLICT', 'You already have a freeze request waiting')
  const request = await db.freezeRequest.create({ data: { gymId, athleteId: athlete.id, membershipId: membership.id, fromDate: from, days: input.days, reason: input.reason.trim() } })
  await notifyStaff(db, gymId, { title: `${athlete.name} asked to freeze for ${input.days} days`, body: `From ${formatIstDate(from, { day: 'numeric', month: 'short' })}. ${input.reason}`.trim(), href: '/owner/payments?tab=freeze' })
  return request
}

export async function decideFreeze(db: TenantDb, gym: { id: string; slug: string }, requestId: string, approve: boolean, actor: Actor) {
  const request = await db.freezeRequest.findFirst({ where: { id: requestId, status: 'PENDING' } })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Request not found or already handled')
  const athlete = await db.athlete.findFirst({ where: { id: request.athleteId }, select: { language: true } })
  const lang = (athlete?.language ?? 'EN') as Lang
  const date = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short' })
  if (approve) {
    const updated = await freezeMembership(db, gym.id, { membershipId: request.membershipId, fromDate: request.fromDate, days: request.days, reason: request.reason || 'Member request' }, actor)
    await db.freezeRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', decidedById: actor.staffId, decidedAt: new Date() } })
    await notifyAthlete(db, gym, request.athleteId, { title: translate(lang, 'notif', 'freezeApproved'), body: translate(lang, 'notif', 'freezeApprovedBody', { days: request.days, date: date(request.fromDate), end: date(updated.endsAt) }), path: '/pay', tag: 'freeze' })
    return { ok: true, endsAt: updated.endsAt }
  }
  await db.freezeRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', decidedById: actor.staffId, decidedAt: new Date() } })
  await notifyAthlete(db, gym, request.athleteId, { title: translate(lang, 'notif', 'freezeRejected'), body: translate(lang, 'notif', 'freezeRejectedBody'), path: '/pay', tag: 'freeze' })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Referral reward notice (after sellMembership returned a referral)
// ---------------------------------------------------------------------------

export async function notifyReferral(db: TenantDb, gym: { id: string; slug: string; name: string }, referral: { referrerId: string; friend: string; days: number } | null | undefined) {
  if (!referral) return
  const referrer = await db.athlete.findFirst({ where: { id: referral.referrerId }, select: { language: true } })
  const lang = (referrer?.language ?? 'EN') as Lang
  await notifyAthlete(db, gym, referral.referrerId, {
    title: translate(lang, 'notif', 'referral'),
    body: translate(lang, 'notif', 'referralBody', { friend: referral.friend.split(' ')[0], gym: gym.name, days: referral.days }),
    path: '/profile',
    tag: 'referral',
  })
}
