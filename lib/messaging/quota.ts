import type { PrismaClient } from '@/lib/generated/prisma/client'
import { notifyGymOwners } from '@/lib/platform/notify'
import { firstName } from './templates'
import { monthKey, quotaCeiling, usagePercent } from './policy'

// Per-gym monthly WhatsApp quota = plan quota + admin top-up.
// Counting is a single conditional UPDATE, so two cron runs or a cron run
// and a "send now" click can never push a gym past its limit.

export interface QuotaState {
  month: string
  quota: number
  sent: number
  blocked: number
  percent: number
}

export async function gymQuota(db: PrismaClient, gymId: string): Promise<number> {
  const [subscription, override] = await Promise.all([
    db.gymSubscription.findUnique({ where: { gymId }, select: { plan: { select: { whatsappQuota: true } } } }),
    db.gymOverride.findUnique({ where: { gymId }, select: { whatsappTopUp: true } }),
  ])
  return (subscription?.plan.whatsappQuota ?? 0) + (override?.whatsappTopUp ?? 0)
}

export async function quotaState(db: PrismaClient, gymId: string, now: Date = new Date()): Promise<QuotaState> {
  const month = monthKey(now)
  const [quota, usage] = await Promise.all([gymQuota(db, gymId), db.whatsAppUsage.findUnique({ where: { gymId_month: { gymId, month } } })])
  const sent = usage?.sent ?? 0
  return { month, quota, sent, blocked: usage?.blocked ?? 0, percent: usagePercent(sent, quota) }
}

async function ensureUsageRow(db: PrismaClient, gymId: string, month: string) {
  try {
    await db.whatsAppUsage.upsert({ where: { gymId_month: { gymId, month } }, create: { gymId, month }, update: {} })
  } catch {
    // Lost a race with another insert - the row exists now.
  }
}

export async function reserveMessage(db: PrismaClient, gymId: string, quota: number, priority: 'critical' | 'normal' | 'low', now: Date = new Date()): Promise<{ ok: boolean; sent: number }> {
  const month = monthKey(now)
  await ensureUsageRow(db, gymId, month)
  const ceiling = quotaCeiling(quota, priority)
  const rows = Number.isFinite(ceiling)
    ? await db.$queryRaw<{ sent: number }[]>`UPDATE "WhatsAppUsage" SET "sent" = "sent" + 1 WHERE "gymId" = ${gymId} AND "month" = ${month} AND "sent" < ${ceiling} RETURNING "sent"`
    : await db.$queryRaw<{ sent: number }[]>`UPDATE "WhatsAppUsage" SET "sent" = "sent" + 1 WHERE "gymId" = ${gymId} AND "month" = ${month} RETURNING "sent"`
  if (rows.length) return { ok: true, sent: Number(rows[0].sent) }
  const blocked = await db.$queryRaw<{ sent: number }[]>`UPDATE "WhatsAppUsage" SET "blocked" = "blocked" + 1 WHERE "gymId" = ${gymId} AND "month" = ${month} RETURNING "sent"`
  return { ok: false, sent: Number(blocked[0]?.sent ?? 0) }
}

// Give the message back when Meta rejected it (failed sends are not billed).
export async function refundMessage(db: PrismaClient, gymId: string, now: Date = new Date()): Promise<void> {
  const month = monthKey(now)
  await db.$executeRaw`UPDATE "WhatsAppUsage" SET "sent" = GREATEST("sent" - 1, 0) WHERE "gymId" = ${gymId} AND "month" = ${month}`
}

// Warn the owner once at 80% and once when the limit is hit (in-app,
// email and a WhatsApp from Rep+'s own number - not counted).
export async function checkQuotaWarnings(db: PrismaClient, gymId: string, quota: number, sent: number, limitHit: boolean, now: Date = new Date()): Promise<'warned80' | 'warned100' | null> {
  if (quota <= 0) return null
  const month = monthKey(now)
  const reached = limitHit || sent >= quota
  if (reached) {
    const flipped = await db.whatsAppUsage.updateMany({ where: { gymId, month, warned100: false }, data: { warned100: true, warned80: true } })
    if (flipped.count === 1) {
      await warnOwners(db, gymId, 100, sent, quota)
      return 'warned100'
    }
    return null
  }
  if (sent >= Math.ceil(quota * 0.8)) {
    const flipped = await db.whatsAppUsage.updateMany({ where: { gymId, month, warned80: false }, data: { warned80: true } })
    if (flipped.count === 1) {
      await warnOwners(db, gymId, usagePercent(sent, quota), sent, quota)
      return 'warned80'
    }
  }
  return null
}

async function warnOwners(db: PrismaClient, gymId: string, percent: number, sent: number, quota: number) {
  const full = percent >= 100
  try {
    await notifyGymOwners(db, gymId, {
      title: full ? 'WhatsApp limit reached for this month' : `WhatsApp messages ${percent}% used`,
      body: full
        ? `Your gym has used all ${quota} WhatsApp messages this month. Only login codes go out until the 1st. Ask Rep+ for a top-up or upgrade your plan.`
        : `Your gym has used ${sent} of ${quota} WhatsApp messages this month. Birthday wishes and weekly reports pause at 90% so dues reminders keep going.`,
      href: '/owner/messages',
      email: true,
      whatsappTemplate: 'kasrat_quota_warning',
      whatsappParams: (owner) => [firstName(owner.name), String(percent), String(sent), String(quota)],
    })
  } catch (error) {
    console.error('[quota] owner warning failed', gymId, error)
  }
}
