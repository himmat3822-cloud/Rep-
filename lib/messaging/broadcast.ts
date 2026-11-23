import 'server-only'
import { z } from 'zod'
import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym, type TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { istDateOnly } from '@/lib/time'
import { audienceSchema, describeAudience, resolveAudience, segmentDays, type Audience, type AudienceMember } from './audience'
import { cleanParam, firstName, PRESET_KEYS, presetLine, type PresetKey } from './templates'
import { enqueue, flushOutbox, nextSendTime, type Channel, type OutboxItem } from './outbox'
import { quotaState } from './quota'
import { isQuietHour, quotaCeiling } from './policy'

// Owner bulk messages ("send this to these members") and automatic rules
// ("every morning, send this to whoever matches"). Both put rows in the
// outbox; the outbox sends them through the normal message pipeline.

export const CHANNELS = ['AUTO', 'WHATSAPP', 'PUSH'] as const

export const messageSchema = z
  .object({
    preset: z.enum(PRESET_KEYS).nullable().default(null),
    customText: z.string().trim().max(300, 'Keep it under 300 characters').nullable().default(null),
    channel: z.enum(CHANNELS).default('AUTO'),
  })
  .refine((value) => Boolean(value.preset) !== Boolean(value.customText && value.customText.length >= 3), { message: 'Pick a ready message or write your own (at least 3 characters)', path: ['customText'] })

export const broadcastSchema = z.object({ audience: audienceSchema, message: messageSchema })
export type BroadcastInput = z.input<typeof broadcastSchema>

export const ruleSchema = z.object({
  name: z.string().trim().min(2, 'Give the rule a name').max(80),
  audience: audienceSchema,
  message: messageSchema,
  cooldownDays: z.coerce.number().int().min(3, 'At least 3 days').max(365).default(14),
  enabled: z.boolean().default(true),
})
export type RuleInput = z.input<typeof ruleSchema>

export const PRESET_LABEL: Record<PresetKey, string> = {
  miss_you: 'We miss you',
  welcome: 'Welcome',
  renew: 'Come back and renew',
  ending: 'Plan ending soon',
  consistency: 'Well done, keep going',
  challenge: 'New challenge',
  dues: 'Pending balance',
}

// Best preset for each member group (shown first in the picker).
export const SUGGESTED_PRESET: Record<Audience['segment'], PresetKey> = {
  all: 'challenge',
  new: 'welcome',
  inactive: 'miss_you',
  ending: 'ending',
  expired: 'renew',
  dues: 'dues',
  regular: 'consistency',
}

type Message = z.output<typeof messageSchema>

function lineFor(member: AudienceMember, message: Message, gymName: string, audience: Audience): string {
  if (!message.preset) return cleanParam(message.customText ?? '', 300)
  const days = message.preset === 'ending' ? (member.daysLeft ?? segmentDays(audience)) : message.preset === 'miss_you' ? member.idleDays : segmentDays(audience)
  return cleanParam(presetLine(member.language, message.preset, { name: firstName(member.name), gym: gymName, days }), 300)
}

function itemsFor(members: AudienceMember[], message: Message, gym: { name: string }, audience: Audience, extra: { purpose: string; campaignId?: string; ruleId?: string; dedupe: (member: AudienceMember) => string | null }): OutboxItem[] {
  return members.map((member) => ({
    athleteId: member.id,
    template: 'kasrat_gym_update',
    language: member.language,
    params: [firstName(member.name), gym.name, lineFor(member, message, gym.name, audience)],
    purpose: extra.purpose,
    dedupeKey: extra.dedupe(member),
    channel: message.channel as Channel,
    push: { title: gym.name, path: '' },
    campaignId: extra.campaignId ?? null,
    ruleId: extra.ruleId ?? null,
  }))
}

export interface BroadcastPreview {
  label: string
  count: number
  sample: { name: string; line: string }[]
  withApp: number
  whatsappNeeded: number
  quotaLeft: number
  quiet: boolean
  sendsAt: string
}

async function names(db: TenantDb, audience: Audience) {
  const [branch, trainer] = await Promise.all([
    audience.branchId ? db.branch.findFirst({ where: { id: audience.branchId }, select: { name: true } }) : null,
    audience.trainerId ? db.gymUser.findFirst({ where: { id: audience.trainerId }, select: { name: true } }) : null,
  ])
  if (audience.branchId && !branch) throw new ApiError(422, 'VALIDATION_ERROR', 'That branch is not part of this gym')
  if (audience.trainerId && !trainer) throw new ApiError(422, 'VALIDATION_ERROR', 'That trainer is not part of this gym')
  return { branch: branch?.name ?? null, trainer: trainer?.name ?? null }
}

export async function previewBroadcast(base: PrismaClient, gym: { id: string; name: string }, audience: Audience, message: Message, now: Date = new Date()): Promise<BroadcastPreview> {
  const db = scopeToGym(base, gym.id)
  const label = describeAudience(audience, await names(db, audience))
  const members = await resolveAudience(db, audience, now)
  const devices = members.length ? await db.pushSubscription.findMany({ where: { athleteId: { in: members.map((m) => m.id) } }, select: { athleteId: true }, distinct: ['athleteId'] }) : []
  const withApp = new Set(devices.map((d) => d.athleteId))
  const appCount = members.filter((m) => withApp.has(m.id)).length
  const whatsappNeeded = message.channel === 'PUSH' ? 0 : message.channel === 'WHATSAPP' ? members.filter((m) => !m.whatsappOptOut).length : members.filter((m) => !withApp.has(m.id) && !m.whatsappOptOut).length
  const quota = await quotaState(base, gym.id, now)
  const when = nextSendTime(now)
  return {
    label,
    count: members.length,
    sample: members.slice(0, 3).map((member) => ({ name: member.name, line: lineFor(member, message, gym.name, audience) })),
    withApp: message.channel === 'WHATSAPP' ? 0 : appCount,
    whatsappNeeded,
    // Bulk messages are low priority: they stop at 90% so dues reminders keep room.
    quotaLeft: Math.max(0, quotaCeiling(quota.quota, 'low') - quota.sent),
    quiet: isQuietHour(now),
    sendsAt: when.toISOString(),
  }
}

export async function sendBroadcast(base: PrismaClient, gym: { id: string; name: string }, staffId: string, input: { audience: Audience; message: Message }, now: Date = new Date()) {
  const db = scopeToGym(base, gym.id)
  const label = describeAudience(input.audience, await names(db, input.audience))
  const members = await resolveAudience(db, input.audience, now)
  if (members.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'No members match this group')
  const campaign = await db.campaign.create({
    data: {
      gymId: gym.id,
      title: input.message.preset ? `${PRESET_LABEL[input.message.preset]} - ${label}` : `Own message - ${label}`,
      audience: input.audience,
      preset: input.message.preset,
      customText: input.message.customText,
      channel: input.message.channel,
      total: members.length,
      createdById: staffId,
      scheduledFor: nextSendTime(now),
    },
  })
  await enqueue(base, gym.id, itemsFor(members, input.message, gym, input.audience, { purpose: 'broadcast', campaignId: campaign.id, dedupe: (member) => `campaign:${campaign.id}:${member.id}` }), now)
  return { id: campaign.id, total: members.length, scheduledFor: campaign.scheduledFor, quiet: isQuietHour(now) }
}

export async function cancelBroadcast(db: TenantDb, id: string) {
  const campaign = await db.campaign.findFirst({ where: { id } })
  if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Message not found')
  const cancelled = await db.outboundMessage.updateMany({ where: { campaignId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
  await db.campaign.updateMany({ where: { id }, data: { cancelledAt: new Date() } })
  return { cancelled: cancelled.count }
}

export interface CampaignRow {
  id: string
  title: string
  channel: string
  total: number
  createdAt: Date
  scheduledFor: Date
  cancelled: boolean
  counts: { sent: number; skipped: number; failed: number; waiting: number; cancelled: number }
}

export async function recentCampaigns(db: TenantDb, limit = 15): Promise<CampaignRow[]> {
  const campaigns = await db.campaign.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  if (campaigns.length === 0) return []
  const grouped = await db.outboundMessage.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: campaigns.map((c) => c.id) } }, _count: { _all: true } })
  return campaigns.map((campaign) => {
    const count = (status: string) => grouped.filter((g) => g.campaignId === campaign.id && g.status === status).reduce((sum, g) => sum + g._count._all, 0)
    return {
      id: campaign.id,
      title: campaign.title,
      channel: campaign.channel,
      total: campaign.total,
      createdAt: campaign.createdAt,
      scheduledFor: campaign.scheduledFor,
      cancelled: Boolean(campaign.cancelledAt),
      counts: { sent: count('SENT'), skipped: count('SKIPPED'), failed: count('FAILED'), waiting: count('PENDING') + count('SENDING'), cancelled: count('CANCELLED') },
    }
  })
}

// ---------------------------------------------------------------------------
// Automatic rules
// ---------------------------------------------------------------------------

export async function createRule(db: TenantDb, gymId: string, staffId: string, input: z.output<typeof ruleSchema>) {
  const count = await db.autoRule.count()
  if (count >= 20) throw new ApiError(422, 'VALIDATION_ERROR', 'A gym can have up to 20 automatic messages')
  await names(db, input.audience)
  return db.autoRule.create({ data: { gymId, name: input.name, audience: input.audience, preset: input.message.preset, customText: input.message.customText, channel: input.message.channel, cooldownDays: input.cooldownDays, enabled: input.enabled, createdById: staffId } })
}

export async function updateRule(db: TenantDb, id: string, input: z.output<typeof ruleSchema>) {
  await names(db, input.audience)
  const updated = await db.autoRule.updateMany({ where: { id }, data: { name: input.name, audience: input.audience, preset: input.message.preset, customText: input.message.customText, channel: input.message.channel, cooldownDays: input.cooldownDays, enabled: input.enabled } })
  if (updated.count === 0) throw new ApiError(404, 'NOT_FOUND', 'Rule not found')
}

export async function setRuleEnabled(db: TenantDb, id: string, enabled: boolean) {
  const updated = await db.autoRule.updateMany({ where: { id }, data: { enabled } })
  if (updated.count === 0) throw new ApiError(404, 'NOT_FOUND', 'Rule not found')
}

export async function deleteRule(db: TenantDb, id: string) {
  await db.outboundMessage.updateMany({ where: { ruleId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
  const removed = await db.autoRule.deleteMany({ where: { id } })
  if (removed.count === 0) throw new ApiError(404, 'NOT_FOUND', 'Rule not found')
}

// Once a day per gym: every enabled rule queues its message for members who
// match now and have not had this rule's message within its cooldown.
export async function runAutoRules(base: PrismaClient, gym: { id: string; name: string }, now: Date = new Date()): Promise<{ ruleId: string; queued: number }[]> {
  const db = scopeToGym(base, gym.id)
  const rules = await db.autoRule.findMany({ where: { enabled: true } })
  const out: { ruleId: string; queued: number }[] = []
  const today = istDateOnly(now).toISOString().slice(0, 10)
  for (const rule of rules) {
    const parsed = audienceSchema.safeParse(rule.audience)
    if (!parsed.success) continue
    const message = { preset: (rule.preset as PresetKey | null) ?? null, customText: rule.customText, channel: rule.channel as Channel }
    const members = await resolveAudience(db, parsed.data, now)
    if (members.length === 0) {
      out.push({ ruleId: rule.id, queued: 0 })
      continue
    }
    const since = new Date(now.getTime() - rule.cooldownDays * 86400000)
    const recent = await db.outboundMessage.findMany({ where: { ruleId: rule.id, athleteId: { in: members.map((m) => m.id) }, createdAt: { gte: since }, status: { not: 'CANCELLED' } }, select: { athleteId: true } })
    const skip = new Set(recent.map((row) => row.athleteId))
    const fresh = members.filter((member) => !skip.has(member.id))
    await enqueue(base, gym.id, itemsFor(fresh, message, gym, parsed.data, { purpose: `rule:${rule.id}`, ruleId: rule.id, dedupe: (member) => `rule:${rule.id}:${member.id}:${today}` }), now)
    await db.autoRule.updateMany({ where: { id: rule.id }, data: { lastRunAt: now } })
    out.push({ ruleId: rule.id, queued: fresh.length })
  }
  return out
}

export interface RuleRow {
  id: string
  name: string
  audienceLabel: string
  audience: Audience
  preset: PresetKey | null
  customText: string | null
  channel: Channel
  cooldownDays: number
  enabled: boolean
  lastRunAt: Date | null
  sent30: number
}

export async function listRules(db: TenantDb, now: Date = new Date()): Promise<RuleRow[]> {
  const rules = await db.autoRule.findMany({ orderBy: { createdAt: 'asc' } })
  if (rules.length === 0) return []
  const [branches, trainers, sent] = await Promise.all([
    db.branch.findMany({ select: { id: true, name: true } }),
    db.gymUser.findMany({ select: { id: true, name: true } }),
    db.outboundMessage.groupBy({ by: ['ruleId'], where: { ruleId: { in: rules.map((r) => r.id) }, status: 'SENT', sentAt: { gte: new Date(now.getTime() - 30 * 86400000) } }, _count: { _all: true } }),
  ])
  return rules.flatMap((rule) => {
    const parsed = audienceSchema.safeParse(rule.audience)
    if (!parsed.success) return []
    const audience = parsed.data
    return [
      {
        id: rule.id,
        name: rule.name,
        audience,
        audienceLabel: describeAudience(audience, { branch: branches.find((b) => b.id === audience.branchId)?.name, trainer: trainers.find((t) => t.id === audience.trainerId)?.name }),
        preset: (rule.preset as PresetKey | null) ?? null,
        customText: rule.customText,
        channel: rule.channel as Channel,
        cooldownDays: rule.cooldownDays,
        enabled: rule.enabled,
        lastRunAt: rule.lastRunAt,
        sent30: sent.find((row) => row.ruleId === rule.id)?._count._all ?? 0,
      },
    ]
  })
}

export async function flushAfterBroadcast(base: PrismaClient, gymId: string) {
  await flushOutbox(base, gymId, new Date(), { limit: 1000 })
}
