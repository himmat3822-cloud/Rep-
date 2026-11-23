import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'
import { QUIET_END_HOUR, isQuietHour } from './policy'
import { loadMessagingContext, sendGymMessage, type MessagingContext, type SendOutcome, type Transport } from './send'
import { isTemplateName, type WaLang } from './templates'
import type { PushTransport } from '@/lib/athlete/push'

// The outbox holds messages that should go out later: bulk sends, automatic
// rules, and nudges made during quiet hours (9 PM - 8 AM). Each row goes
// through the normal pipeline (quiet hours, push first, opt-out, dedupe,
// quota), so nothing here can skip those rules.
//
// It is emptied by the daily messages job and, during the day, a few
// minutes after any staff screen loads (see app/api/gym/notifications).

export type Channel = 'AUTO' | 'WHATSAPP' | 'PUSH'

export interface OutboxItem {
  athleteId: string
  template: string
  language: WaLang
  params: string[]
  purpose: string
  dedupeKey?: string | null
  channel?: Channel
  push?: { title: string; path: string }
  campaignId?: string | null
  ruleId?: string | null
  sendAfter?: Date
}

// 8:00 AM IST on the next morning that is not in quiet hours.
export function nextSendTime(now: Date = new Date()): Date {
  if (!isQuietHour(now)) return now
  const { hour } = istParts(now)
  const day = istDateOnly(now)
  const target = hour < QUIET_END_HOUR ? day : new Date(day.getTime() + 86400000)
  return new Date(target.getTime() + QUIET_END_HOUR * 3600000 - IST_OFFSET_MS)
}

export async function enqueue(base: PrismaClient, gymId: string, items: OutboxItem[], now: Date = new Date()): Promise<number> {
  if (items.length === 0) return 0
  const when = nextSendTime(now)
  for (let offset = 0; offset < items.length; offset += 500) {
    await base.outboundMessage.createMany({
      data: items.slice(offset, offset + 500).map((item) => ({
        gymId,
        athleteId: item.athleteId,
        campaignId: item.campaignId ?? null,
        ruleId: item.ruleId ?? null,
        template: item.template,
        language: item.language,
        params: item.params,
        purpose: item.purpose,
        dedupeKey: item.dedupeKey ?? null,
        channel: item.channel ?? 'AUTO',
        pushTitle: item.push?.title ?? null,
        pushPath: item.push?.path ?? null,
        sendAfter: item.sendAfter && item.sendAfter > when ? item.sendAfter : when,
      })),
    })
  }
  return items.length
}

export interface FlushResult {
  sent: number
  skipped: number
  failed: number
  waiting: number
}

const FINAL: Partial<Record<SendOutcome, 'SKIPPED'>> = { duplicate: 'SKIPPED', opted_out: 'SKIPPED', no_push: 'SKIPPED', quota: 'SKIPPED' }

// Sends what is due for one gym. Stops at quiet hours or a paused gym and
// leaves the rest PENDING for the next run.
export async function flushOutbox(base: PrismaClient, gymId: string, now: Date = new Date(), options: { limit?: number; transport?: Transport; push?: PushTransport; ctx?: MessagingContext } = {}): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, skipped: 0, failed: 0, waiting: 0 }
  if (isQuietHour(now)) return result
  const db = scopeToGym(base, gymId)
  // A run that crashed mid-send leaves rows in SENDING; give them back.
  await db.outboundMessage.updateMany({ where: { status: 'SENDING', createdAt: { lt: new Date(now.getTime() - 15 * 60000) }, sentAt: null }, data: { status: 'PENDING' } })
  const due = await db.outboundMessage.findMany({ where: { status: 'PENDING', sendAfter: { lte: now } }, orderBy: { sendAfter: 'asc' }, take: options.limit ?? 300 })
  if (due.length === 0) return result
  const ctx = options.ctx ?? (await loadMessagingContext(base, gymId, options.transport, options.push))
  const athletes = await db.athlete.findMany({ where: { id: { in: [...new Set(due.map((row) => row.athleteId))] } }, select: { id: true, phone: true, whatsappOptOut: true, archived: true } })
  const byId = new Map(athletes.map((athlete) => [athlete.id, athlete]))

  for (const row of due) {
    // Claim the row so two runs never send it twice.
    const claimed = await db.outboundMessage.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'SENDING', attempts: { increment: 1 } } })
    if (claimed.count === 0) continue
    const athlete = byId.get(row.athleteId)
    if (!athlete || athlete.archived || !isTemplateName(row.template)) {
      await db.outboundMessage.updateMany({ where: { id: row.id }, data: { status: 'SKIPPED', outcome: 'member_removed' } })
      result.skipped += 1
      continue
    }
    const push = row.channel !== 'WHATSAPP' && row.pushTitle ? { title: row.pushTitle, path: row.pushPath ?? '' } : undefined
    let outcome: SendOutcome
    let error: string | undefined
    try {
      const sent = await sendGymMessage(
        base,
        ctx,
        {
          template: row.template,
          language: row.language as WaLang,
          params: (row.params as string[]) ?? [],
          to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
          purpose: row.purpose,
          dedupeKey: row.dedupeKey ?? undefined,
          pushFirst: push,
          pushOnly: row.channel === 'PUSH',
        },
        now,
      )
      outcome = sent.outcome
      error = sent.error
    } catch (caught) {
      outcome = 'failed'
      error = caught instanceof Error ? caught.message.slice(0, 200) : 'Send failed'
    }

    if (outcome === 'sent') {
      await db.outboundMessage.updateMany({ where: { id: row.id }, data: { status: 'SENT', outcome, sentAt: now } })
      result.sent += 1
    } else if (outcome === 'quiet_hours' || outcome === 'paused') {
      // Put it back and stop: nothing else can go out right now.
      await db.outboundMessage.updateMany({ where: { id: row.id }, data: { status: 'PENDING', outcome } })
      result.waiting = await db.outboundMessage.count({ where: { status: 'PENDING' } })
      return result
    } else if (FINAL[outcome]) {
      await db.outboundMessage.updateMany({ where: { id: row.id }, data: { status: 'SKIPPED', outcome } })
      result.skipped += 1
    } else {
      const retry = row.attempts + 1 < 3
      await db.outboundMessage.updateMany({ where: { id: row.id }, data: { status: retry ? 'PENDING' : 'FAILED', outcome: error ?? outcome } })
      if (!retry) result.failed += 1
    }
  }
  result.waiting = await db.outboundMessage.count({ where: { status: 'PENDING' } })
  return result
}

// All gyms with something due (the daily messages job).
export async function flushAllOutboxes(base: PrismaClient, now: Date = new Date()): Promise<Record<string, FlushResult>> {
  const gyms = await base.outboundMessage.groupBy({ by: ['gymId'], where: { status: 'PENDING', sendAfter: { lte: now } } })
  const out: Record<string, FlushResult> = {}
  for (const { gymId } of gyms) out[gymId] = await flushOutbox(base, gymId, now, { limit: 2000 })
  return out
}
