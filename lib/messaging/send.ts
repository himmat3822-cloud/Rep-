import { Prisma, type PrismaClient } from '@/lib/generated/prisma/client'
import { sendWhatsAppTemplate, type SendResult, type TemplateMessage } from '@/lib/integrations/whatsapp'
import { cleanParam, renderTemplate, TEMPLATES, type TemplateName, type WaLang } from './templates'
import { gymCanMessage, isQuietHour } from './policy'
import { checkQuotaWarnings, gymQuota, refundMessage, reserveMessage } from './quota'
import { scopeToGym } from '@/lib/db/tenant-core'
import { pushToAthlete, type PushTransport } from '@/lib/athlete/push'

// The one way gym messages go out. In order:
//   paused gym?        -> skip (critical messages excepted)
//   quiet hours?       -> skip, the next run picks it up (9 PM - 8 AM IST)
//   push first?        -> nice-to-have messages go to the member's phones by
//                         web push (free); WhatsApp only if no device took it
//   member opted out?  -> skip (STOP on WhatsApp)
//   dedupe key used?   -> skip (a reminder stage is never sent twice)
//   quota left?        -> else log BLOCKED (low priority stops at 90%)
//   send               -> log SENT / FAILED; failures give the quota back
// Delivery and read receipts arrive later via /api/webhooks/whatsapp.

export type Transport = (message: TemplateMessage) => Promise<SendResult>

export interface MessagingContext {
  gymId: string
  slug: string
  status: string
  quota: number
  transport?: Transport
  push?: PushTransport
}

export interface GymMessage {
  template: TemplateName
  params: string[]
  language: WaLang
  to: { phone: string; athleteId?: string; staffId?: string; optedOut?: boolean }
  purpose: string
  dedupeKey?: string
  // Force through quiet hours (only for owner-triggered sends that the
  // owner explicitly confirmed). Defaults to false.
  ignoreQuietHours?: boolean
  // Try web push first (title + app path); WhatsApp only as a fallback.
  pushFirst?: { title: string; path: string }
}

export type SendOutcome = 'sent' | 'duplicate' | 'quiet_hours' | 'quota' | 'opted_out' | 'paused' | 'failed'

export interface SendOutcomeResult {
  outcome: SendOutcome
  logId?: string
  error?: string
}

export async function loadMessagingContext(db: PrismaClient, gymId: string, transport?: Transport, push?: PushTransport): Promise<MessagingContext> {
  const [gym, quota] = await Promise.all([db.gym.findUnique({ where: { id: gymId }, select: { subscriptionStatus: true, slug: true } }), gymQuota(db, gymId)])
  return { gymId, slug: gym?.slug ?? '', status: gym?.subscriptionStatus ?? 'SUSPENDED', quota, transport, push }
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function sendGymMessage(db: PrismaClient, ctx: MessagingContext, message: GymMessage, now: Date = new Date()): Promise<SendOutcomeResult> {
  const def = TEMPLATES[message.template]
  const critical = def.priority === 'critical'

  if (!critical && !gymCanMessage(ctx.status)) return { outcome: 'paused' }
  if (!critical && !message.ignoreQuietHours && isQuietHour(now)) return { outcome: 'quiet_hours' }
  const params = message.params.map((param) => cleanParam(param))
  const body = renderTemplate(message.template, message.language, params)

  if (message.pushFirst && message.to.athleteId) {
    const pushed = await tryPush(db, ctx, message, body, now)
    if (pushed) return pushed
  }
  if (!critical && def.audience === 'member' && message.to.optedOut) return { outcome: 'opted_out' }

  let logId: string
  try {
    const log = await db.messageLog.create({
      data: {
        gymId: ctx.gymId,
        athleteId: message.to.athleteId ?? null,
        staffId: message.to.staffId ?? null,
        channel: 'WHATSAPP',
        template: message.template,
        language: message.language,
        purpose: message.purpose,
        dedupeKey: message.dedupeKey ?? null,
        critical,
        toPhone: message.to.phone,
        body,
        status: 'QUEUED',
        createdAt: now,
      },
      select: { id: true },
    })
    logId = log.id
  } catch (error) {
    if (isUniqueError(error)) return { outcome: 'duplicate' }
    throw error
  }

  const countsAgainstQuota = !('platform' in def && def.platform)
  if (countsAgainstQuota) {
    const reservation = await reserveMessage(db, ctx.gymId, ctx.quota, def.priority, now)
    if (!reservation.ok) {
      // Free the dedupe key so the message can go out after a top-up.
      await db.messageLog.update({ where: { id: logId }, data: { status: 'BLOCKED', error: 'Monthly WhatsApp limit reached', dedupeKey: null } })
      await checkQuotaWarnings(db, ctx.gymId, ctx.quota, reservation.sent, def.priority === 'normal', now)
      return { outcome: 'quota', logId }
    }
    await checkQuotaWarnings(db, ctx.gymId, ctx.quota, reservation.sent, false, now)
  }

  try {
    const transport = ctx.transport ?? sendWhatsAppTemplate
    const result = await transport({ to: message.to.phone, template: message.template, language: message.language, bodyParams: params })
    await db.messageLog.update({
      where: { id: logId },
      data: { status: 'SENT', sentAt: now, providerId: result.providerId ?? `dev_${logId}`, error: result.skipped ? 'Not sent: WhatsApp is not configured (logged to the server console)' : null },
    })
    return { outcome: 'sent', logId }
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : 'Send failed'
    await db.messageLog.update({ where: { id: logId }, data: { status: 'FAILED', error: reason, dedupeKey: null } })
    if (countsAgainstQuota) await refundMessage(db, ctx.gymId, now)
    return { outcome: 'failed', logId, error: reason }
  }
}

// Claims the dedupe key with a PUSH log row, then pushes. If no device took
// it, the row is removed so the WhatsApp path can claim the same key.
async function tryPush(db: PrismaClient, ctx: MessagingContext, message: GymMessage, body: string, now: Date): Promise<SendOutcomeResult | null> {
  const tenant = scopeToGym(db, ctx.gymId)
  const devices = await tenant.pushSubscription.count({ where: { athleteId: message.to.athleteId } })
  if (devices === 0) return null
  let logId: string
  try {
    const log = await db.messageLog.create({
      data: { gymId: ctx.gymId, athleteId: message.to.athleteId ?? null, channel: 'PUSH', template: message.template, language: message.language, purpose: message.purpose, dedupeKey: message.dedupeKey ?? null, body, status: 'QUEUED', createdAt: now },
      select: { id: true },
    })
    logId = log.id
  } catch (error) {
    if (isUniqueError(error)) return { outcome: 'duplicate' }
    throw error
  }
  const delivered = await pushToAthlete(tenant, message.to.athleteId!, { title: message.pushFirst!.title, body, url: `/g/${ctx.slug}${message.pushFirst!.path}`, tag: message.purpose }, ctx.push)
  if (delivered > 0) {
    await db.messageLog.update({ where: { id: logId }, data: { status: 'SENT', sentAt: now, deliveredAt: now } })
    return { outcome: 'sent', logId }
  }
  await db.messageLog.delete({ where: { id: logId } })
  return null
}
