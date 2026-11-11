import type { PrismaClient } from '@/lib/generated/prisma/client'
import { Prisma } from '@/lib/generated/prisma/client'
import type { RazorpayWebhook } from '@/lib/integrations/razorpay'
import { auditWith } from '@/lib/audit-core'
import { recordPlatformPayment } from './billing-service'

// Razorpay -> Rep+. Called after the signature is verified.
// Idempotent: each X-Razorpay-Event-Id is processed at most once.
// Gym-member payments (payment links, orders) are added in Phase 5.

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'unmatched'

async function claimEvent(db: PrismaClient, eventId: string, body: RazorpayWebhook): Promise<boolean> {
  try {
    await db.webhookEvent.create({ data: { provider: 'razorpay', eventId, type: body.event, payload: body as unknown as Prisma.InputJsonValue } })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await db.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'razorpay', eventId } } })
      // A previous attempt crashed before finishing: let this retry through.
      return Boolean(existing && !existing.processedAt)
    }
    throw error
  }
}

async function findSubscription(db: PrismaClient, body: RazorpayWebhook) {
  const entity = body.payload.subscription?.entity
  if (!entity) return null
  const bySubId = await db.gymSubscription.findUnique({ where: { razorpaySubscriptionId: entity.id } })
  if (bySubId) return bySubId
  const gymId = entity.notes?.gymId
  if (!gymId) return null
  const byGym = await db.gymSubscription.findUnique({ where: { gymId } })
  if (byGym && !byGym.razorpaySubscriptionId) {
    return db.gymSubscription.update({ where: { gymId }, data: { razorpaySubscriptionId: entity.id } })
  }
  return byGym
}

export async function processRazorpayEvent(db: PrismaClient, eventId: string, body: RazorpayWebhook): Promise<WebhookOutcome> {
  if (!(await claimEvent(db, eventId, body))) return 'duplicate'

  let outcome: WebhookOutcome = 'ignored'
  try {
    switch (body.event) {
      case 'subscription.charged': {
        const sub = await findSubscription(db, body)
        const payment = body.payload.payment?.entity
        if (!sub || !payment) {
          outcome = 'unmatched'
          break
        }
        await recordPlatformPayment(db, {
          gymId: sub.gymId,
          totalPaise: payment.amount,
          paidAt: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
          razorpayPaymentId: payment.id,
          actor: { type: 'SYSTEM', id: 'razorpay-webhook' },
          note: 'paid via Razorpay',
        })
        outcome = 'processed'
        break
      }
      case 'subscription.activated':
      case 'subscription.authenticated': {
        outcome = (await findSubscription(db, body)) ? 'processed' : 'unmatched'
        break
      }
      case 'subscription.cancelled': {
        const sub = await findSubscription(db, body)
        if (!sub) {
          outcome = 'unmatched'
          break
        }
        // Keep access until the paid period ends; the cron then moves it to CANCELLED.
        await db.gymSubscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, statusReason: 'cancelled in Razorpay' } })
        await auditWith(db, { gymId: sub.gymId, actorType: 'SYSTEM', actorId: 'razorpay-webhook', action: 'billing.cancel_at_period_end', entity: 'GymSubscription', entityId: sub.id })
        outcome = 'processed'
        break
      }
      case 'subscription.halted':
      case 'subscription.pending': {
        // Razorpay gave up retrying the card/UPI mandate. The due date logic
        // already moves the gym to PAST_DUE; we just record it.
        const sub = await findSubscription(db, body)
        if (sub) {
          await auditWith(db, { gymId: sub.gymId, actorType: 'SYSTEM', actorId: 'razorpay-webhook', action: `billing.${body.event.replace('subscription.', '')}`, entity: 'GymSubscription', entityId: sub.id })
          outcome = 'processed'
        } else outcome = 'unmatched'
        break
      }
      default:
        outcome = 'ignored'
    }
    await db.webhookEvent.update({ where: { provider_eventId: { provider: 'razorpay', eventId } }, data: { processedAt: new Date(), error: outcome === 'unmatched' ? 'no matching gym subscription' : null } })
    return outcome
  } catch (error) {
    await db.webhookEvent.update({ where: { provider_eventId: { provider: 'razorpay', eventId } }, data: { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error' } })
    throw error
  }
}
