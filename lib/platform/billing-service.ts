import type { GymSubscription, GymOverride, Prisma, PrismaClient } from '@/lib/generated/prisma/client'
import { auditWith } from '@/lib/audit-core'
import { financialYearOf } from '@/lib/gst'
import { notifyGymOwners } from './notify'
import { adminRestore, adminSuspend, applyPayment, evaluateBilling, extendTrial, GST_PERCENT, GRACE_DAYS, SUSPEND_AFTER_DAYS, type BillingEvent, type BillingSnapshot, type Cycle } from './billing'

// DB side of Rep+ billing. Every status change goes through
// persistSnapshot so Gym.subscriptionStatus (read on every request) and
// GymSubscription.status never drift apart.

type Tx = Prisma.TransactionClient
const DAY_MS = 24 * 3600 * 1000

export function toSnapshot(sub: GymSubscription, override: Pick<GymOverride, 'freeMonthsLeft'> | null): BillingSnapshot {
  return {
    status: sub.status,
    cycle: sub.cycle,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    nextDueAt: sub.nextDueAt,
    pastDueSince: sub.pastDueSince,
    suspendedAt: sub.suspendedAt,
    dataPurgeAfter: sub.dataPurgeAfter,
    manualOverride: sub.manualOverride,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    freeMonthsLeft: override?.freeMonthsLeft ?? 0,
  }
}

export async function persistSnapshot(tx: Tx, gymId: string, snapshot: BillingSnapshot, statusReason?: string | null) {
  await tx.gymSubscription.update({
    where: { gymId },
    data: {
      status: snapshot.status,
      cycle: snapshot.cycle,
      trialEndsAt: snapshot.trialEndsAt,
      currentPeriodStart: snapshot.currentPeriodStart,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      nextDueAt: snapshot.nextDueAt,
      pastDueSince: snapshot.pastDueSince,
      suspendedAt: snapshot.suspendedAt,
      dataPurgeAfter: snapshot.dataPurgeAfter,
      manualOverride: snapshot.manualOverride,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      ...(statusReason !== undefined ? { statusReason } : {}),
    },
  })
  await tx.gymOverride.upsert({
    where: { gymId },
    create: { gymId, freeMonthsLeft: snapshot.freeMonthsLeft },
    update: { freeMonthsLeft: snapshot.freeMonthsLeft },
  })
  await tx.gym.update({ where: { id: gymId }, data: { subscriptionStatus: snapshot.status } })
}

async function loadSnapshot(tx: Tx | PrismaClient, gymId: string) {
  const sub = await tx.gymSubscription.findUnique({ where: { gymId } })
  if (!sub) throw new Error(`Gym ${gymId} has no Rep+ subscription`)
  const override = await tx.gymOverride.findUnique({ where: { gymId }, select: { freeMonthsLeft: true } })
  return { sub, snapshot: toSnapshot(sub, override) }
}

// ---------------------------------------------------------------------------
// Cron: move every gym along the state machine + owner reminders
// ---------------------------------------------------------------------------

const EVENT_MESSAGES: Record<Exclude<BillingEvent, 'purge_due'>, { title: string; body: string }> = {
  trial_ended: { title: 'Your Rep+ trial has ended', body: `Pick a plan to keep everything running. You have a ${GRACE_DAYS}-day grace period before Rep+ becomes read-only.` },
  free_month_used: { title: 'A free month was applied', body: 'One of your free Rep+ months was used. Nothing to pay this month.' },
  past_due: { title: 'Rep+ payment due', body: `Your Rep+ payment is due. Pay within ${GRACE_DAYS} days to avoid read-only mode.` },
  read_only: { title: 'Rep+ is now read-only', body: `Your Rep+ subscription is unpaid, so staff can view but not change anything and members see a paused message. Rep+ is suspended ${SUSPEND_AFTER_DAYS} days after the due date.` },
  suspended: { title: 'Rep+ access suspended', body: 'Your Rep+ access is suspended. Only the billing page works. Your data is kept for 90 days.' },
  cancelled: { title: 'Rep+ subscription cancelled', body: 'Your Rep+ subscription has ended. Your data is kept for 90 days in case you come back.' },
}

export interface BillingRunSummary {
  checked: number
  changed: number
  transitions: { gymId: string; from: string; to: string; events: BillingEvent[] }[]
  reminders: number
  purgeDue: string[]
}

export async function runBillingCycle(db: PrismaClient, now: Date = new Date()): Promise<BillingRunSummary> {
  const subs = await db.gymSubscription.findMany({ include: { gym: { select: { id: true, name: true } } } })
  const overrides = await db.gymOverride.findMany({ select: { gymId: true, freeMonthsLeft: true } })
  const freeByGym = new Map(overrides.map((row) => [row.gymId, row]))
  const summary: BillingRunSummary = { checked: subs.length, changed: 0, transitions: [], reminders: 0, purgeDue: [] }

  for (const sub of subs) {
    const snapshot = toSnapshot(sub, freeByGym.get(sub.gymId) ?? null)
    const result = evaluateBilling(snapshot, now)
    if (result.events.includes('purge_due')) summary.purgeDue.push(sub.gymId)

    if (result.changed) {
      await db.$transaction(async (tx) => {
        await persistSnapshot(tx, sub.gymId, result.next, `auto: ${result.events.join(', ')}`)
        await auditWith(tx, {
          gymId: sub.gymId,
          actorType: 'SYSTEM',
          actorId: 'billing-cron',
          action: 'billing.transition',
          entity: 'GymSubscription',
          entityId: sub.id,
          meta: { from: snapshot.status, to: result.next.status, events: result.events },
        })
      })
      summary.changed += 1
      summary.transitions.push({ gymId: sub.gymId, from: snapshot.status, to: result.next.status, events: result.events })
      const last = [...result.events].reverse().find((event) => event !== 'purge_due') as Exclude<BillingEvent, 'purge_due'> | undefined
      if (last) {
        const message = EVENT_MESSAGES[last]
        await notifyGymOwners(db, sub.gymId, { ...message, href: '/owner/billing', email: true, whatsappTemplate: 'kasrat_billing_notice' })
        await db.gymSubscription.update({ where: { gymId: sub.gymId }, data: { lastReminderAt: now } })
        summary.reminders += 1
      }
      continue
    }

    // Daily nudge while unpaid, and one heads-up 3 days before a trial ends.
    const lastReminder = sub.lastReminderAt?.getTime() ?? 0
    const remindedToday = now.getTime() - lastReminder < 20 * 3600 * 1000
    const trialEndingSoon = sub.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt.getTime() - now.getTime() <= 3 * DAY_MS && sub.trialEndsAt.getTime() > now.getTime()
    if (!remindedToday && (sub.status === 'PAST_DUE' || sub.status === 'READ_ONLY' || (trialEndingSoon && lastReminder < (sub.trialEndsAt?.getTime() ?? 0) - 4 * DAY_MS))) {
      const message = trialEndingSoon
        ? { title: 'Your Rep+ trial ends soon', body: 'Your free trial ends in 3 days or less. Pick a plan so nothing stops.' }
        : sub.status === 'PAST_DUE'
          ? EVENT_MESSAGES.past_due
          : EVENT_MESSAGES.read_only
      await notifyGymOwners(db, sub.gymId, { ...message, href: '/owner/billing', email: true, whatsappTemplate: 'kasrat_billing_notice' })
      await db.gymSubscription.update({ where: { gymId: sub.gymId }, data: { lastReminderAt: now } })
      summary.reminders += 1
    }
  }
  return summary
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export { financialYearOf }

export async function nextPlatformInvoiceNumber(tx: Tx, date: Date): Promise<string> {
  const fy = financialYearOf(date)
  const counter = await tx.platformCounter.upsert({
    where: { key: `invoice:${fy}` },
    create: { key: `invoice:${fy}`, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `RP/${fy}/${String(counter.value).padStart(5, '0')}`
}

export interface PlatformPaymentInput {
  gymId: string
  totalPaise: number
  paidAt: Date
  cycle?: Cycle
  razorpayPaymentId?: string | null
  actor: { type: 'ADMIN' | 'SYSTEM'; id: string; adminUserId?: string | null; ip?: string | null }
  note?: string
}

// Records a Rep+ payment (Razorpay webhook or admin "mark paid") and
// restores the gym. Idempotent on razorpayPaymentId.
export async function recordPlatformPayment(db: PrismaClient, input: PlatformPaymentInput) {
  if (input.razorpayPaymentId) {
    const existing = await db.platformInvoice.findUnique({ where: { razorpayPaymentId: input.razorpayPaymentId } })
    if (existing) return { invoice: existing, duplicate: true as const }
  }
  return db.$transaction(async (tx) => {
    const { sub, snapshot } = await loadSnapshot(tx, input.gymId)
    const next = applyPayment(snapshot, input.paidAt, input.cycle ?? snapshot.cycle)
    const subtotal = Math.round((input.totalPaise * 100) / (100 + GST_PERCENT))
    const invoice = await tx.platformInvoice.create({
      data: {
        subscriptionId: sub.id,
        number: await nextPlatformInvoiceNumber(tx, input.paidAt),
        amountPaise: subtotal,
        gstPaise: input.totalPaise - subtotal,
        status: 'PAID',
        periodStart: next.currentPeriodStart ?? input.paidAt,
        periodEnd: next.currentPeriodEnd ?? input.paidAt,
        dueAt: snapshot.nextDueAt ?? input.paidAt,
        paidAt: input.paidAt,
        razorpayPaymentId: input.razorpayPaymentId ?? null,
      },
    })
    await persistSnapshot(tx, input.gymId, next, input.note ?? 'paid')
    await auditWith(tx, {
      gymId: input.gymId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      adminUserId: input.actor.adminUserId ?? null,
      action: snapshot.status === 'ACTIVE' ? 'billing.payment_recorded' : 'billing.restored_by_payment',
      entity: 'PlatformInvoice',
      entityId: invoice.id,
      meta: { from: snapshot.status, to: next.status, totalPaise: input.totalPaise, razorpayPaymentId: input.razorpayPaymentId ?? null },
      ip: input.actor.ip ?? null,
    })
    return { invoice, duplicate: false as const }
  })
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export type AdminBillingAction = { kind: 'suspend' } | { kind: 'restore' } | { kind: 'extend_trial'; days: number } | { kind: 'free_months'; months: number } | { kind: 'cancel' }

export async function adminBillingAction(db: PrismaClient, gymId: string, action: AdminBillingAction, actor: { adminUserId: string; reason: string; ip?: string | null }) {
  return db.$transaction(async (tx) => {
    const { sub, snapshot } = await loadSnapshot(tx, gymId)
    let next: BillingSnapshot
    switch (action.kind) {
      case 'suspend':
        next = adminSuspend(snapshot)
        break
      case 'restore':
        next = adminRestore(snapshot)
        break
      case 'extend_trial':
        next = extendTrial(snapshot, action.days)
        break
      case 'free_months':
        next = { ...snapshot, freeMonthsLeft: snapshot.freeMonthsLeft + action.months }
        // A gym stuck unpaid gets restored immediately by the gift.
        if (snapshot.status === 'PAST_DUE' || snapshot.status === 'READ_ONLY' || (snapshot.status === 'SUSPENDED' && !snapshot.manualOverride)) {
          next = { ...applyPayment(snapshot, new Date(), 'MONTHLY'), freeMonthsLeft: snapshot.freeMonthsLeft + action.months - 1 }
        }
        break
      case 'cancel':
        next = { ...snapshot, status: 'CANCELLED', dataPurgeAfter: new Date(Date.now() + 90 * DAY_MS), manualOverride: true }
        break
    }
    await persistSnapshot(tx, gymId, next, `admin: ${actor.reason}`)
    await auditWith(tx, {
      gymId,
      actorType: 'ADMIN',
      actorId: actor.adminUserId,
      adminUserId: actor.adminUserId,
      action: `gym.${action.kind}`,
      entity: 'GymSubscription',
      entityId: sub.id,
      reason: actor.reason,
      meta: { from: snapshot.status, to: next.status, ...('days' in action ? { days: action.days } : {}), ...('months' in action ? { months: action.months } : {}) },
      ip: actor.ip ?? null,
    })
    return { from: snapshot.status, to: next.status }
  })
}
