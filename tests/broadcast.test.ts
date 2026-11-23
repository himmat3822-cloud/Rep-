import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { resolveAudience, describeAudience, audienceSchema } from '@/lib/messaging/audience'
import { nextSendTime, flushOutbox } from '@/lib/messaging/outbox'
import { broadcastSchema, cancelBroadcast, createRule, previewBroadcast, recentCampaigns, ruleSchema, runAutoRules, sendBroadcast } from '@/lib/messaging/broadcast'
import { PRESET_KEYS, presetLine, renderTemplate } from '@/lib/messaging/templates'
import { loadMessagingContext, type Transport } from '@/lib/messaging/send'
import { purgeGymData } from '@/lib/platform/purge'
import { addDays, istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

const ist = (iso: string) => new Date(Date.parse(`${iso}+05:30`))
const NOON = ist('2026-11-24T12:00:00')
const NIGHT = ist('2026-11-23T23:30:00')

describe('bulk messages: pure parts', () => {
  it('quiet hours push the send to 8 AM the next morning', () => {
    expect(nextSendTime(NOON)).toEqual(NOON)
    expect(nextSendTime(NIGHT).toISOString()).toBe(ist('2026-11-24T08:00:00').toISOString())
    expect(nextSendTime(ist('2026-11-24T05:10:00')).toISOString()).toBe(ist('2026-11-24T08:00:00').toISOString())
  })

  it('ready messages exist in English, Hindi and Punjabi and fill name, gym and days', () => {
    for (const key of PRESET_KEYS) {
      for (const lang of ['EN', 'HI', 'PA'] as const) {
        const line = presetLine(lang, key, { name: 'Arjun', gym: 'Sharp', days: 9 })
        expect(line, `${key} ${lang}`).not.toMatch(/\{(name|gym|days)\}/)
        expect(line.length).toBeGreaterThan(10)
      }
    }
    expect(presetLine('EN', 'miss_you', { name: 'Arjun', gym: 'Sharp', days: 9 })).toContain('9 days, Arjun')
    expect(renderTemplate('kasrat_gym_update', 'EN', ['Arjun', 'Sharp', 'Hello'])).toContain('a message from Sharp')
  })

  it('needs either a ready message or own words', () => {
    const audience = { segment: 'all' }
    expect(broadcastSchema.safeParse({ audience, message: { preset: 'welcome' } }).success).toBe(true)
    expect(broadcastSchema.safeParse({ audience, message: { customText: 'Gym closed on Sunday' } }).success).toBe(true)
    expect(broadcastSchema.safeParse({ audience, message: {} }).success).toBe(false)
    expect(broadcastSchema.safeParse({ audience, message: { preset: 'welcome', customText: 'both' } }).success).toBe(false)
    expect(ruleSchema.safeParse({ name: 'x', audience, message: { preset: 'welcome' } }).success).toBe(false)
    expect(audienceSchema.safeParse({ segment: 'everyone' }).success).toBe(false)
    expect(describeAudience({ segment: 'inactive', days: 10 }, { branch: 'Zirakpur' })).toBe('Not coming for 10+ days, Zirakpur branch')
  })
})

describe('bulk messages and automatic rules (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  const sent: { to: string; params: string[]; template: string }[] = []
  const transport: Transport = async (message) => {
    sent.push({ to: message.to, params: message.bodyParams ?? [], template: message.template })
    return { providerId: `wamid.${uniq('b')}`, skipped: false }
  }
  const ids: Record<string, string> = {}
  let zirakpur: string
  let trainer: string

  beforeAll(async () => {
    G = await makeGym(base, 'Bulk')
    db = scopeToGym(base, G.gym.id)
    const plan = await base.platformPlan.upsert({
      where: { code: 'bulk-plan' },
      create: { code: 'bulk-plan', name: 'Bulk', monthlyPricePaise: 100, annualPricePaise: 1000, branchLimit: 3, whatsappQuota: 100, features: [] },
      update: { whatsappQuota: 100 },
    })
    await db.gymSubscription.create({ data: { gymId: G.gym.id, planId: plan.id, status: 'ACTIVE' } })
    zirakpur = (await db.branch.create({ data: { gymId: G.gym.id, name: 'Zirakpur', entranceQrSecret: uniq('qr') } })).id
    const role = await db.role.create({ data: { gymId: G.gym.id, key: 'TRAINER', name: 'Trainer', permissions: [], isSystem: true } })
    trainer = (await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Inder', phone: `+9196${Math.floor(10000000 + Math.random() * 89999999)}` } })).id
    const today = istDateOnly(NOON)
    await db.athlete.update({ where: { id: G.athlete.id }, data: { joinedAt: addDays(today, -400), lastVisitAt: new Date(NOON.getTime() - 86400000) } })
    const plan2 = await db.membershipPlan.create({ data: { gymId: G.gym.id, name: 'Monthly', durationDays: 30, pricePaise: 150000 } })
    const make = async (key: string, data: { lastVisitDaysAgo?: number | null; joinedDaysAgo: number; endsIn?: number | null; branch?: string; trainerId?: string; language?: 'EN' | 'HI' | 'PA'; status?: 'NEW' | 'REGULAR' }) => {
      const athlete = await db.athlete.create({
        data: {
          gymId: G.gym.id,
          homeBranchId: data.branch ?? G.branch.id,
          trainerId: data.trainerId ?? null,
          memberCode: uniq('B'),
          name: `${key} Member`,
          phone: `+9195${Math.floor(10000000 + Math.random() * 89999999)}`,
          referralCode: uniq('R'),
          language: data.language ?? 'EN',
          status: data.status ?? 'NEW',
          joinedAt: addDays(today, -data.joinedDaysAgo),
          lastVisitAt: data.lastVisitDaysAgo === null || data.lastVisitDaysAgo === undefined ? null : new Date(NOON.getTime() - data.lastVisitDaysAgo * 86400000),
        },
      })
      if (data.endsIn !== null && data.endsIn !== undefined) {
        await db.membership.create({ data: { gymId: G.gym.id, athleteId: athlete.id, planId: plan2.id, status: data.endsIn >= 0 ? 'ACTIVE' : 'EXPIRED', startsAt: addDays(today, data.endsIn - 30), endsAt: addDays(today, data.endsIn), pricePaise: 150000 } })
      }
      ids[key] = athlete.id
    }
    await make('Regular', { lastVisitDaysAgo: 1, joinedDaysAgo: 200, endsIn: 20, status: 'REGULAR' })
    await make('Idle', { lastVisitDaysAgo: 10, joinedDaysAgo: 120, endsIn: 15, branch: zirakpur, trainerId: trainer, language: 'PA' })
    await make('Ending', { lastVisitDaysAgo: 2, joinedDaysAgo: 60, endsIn: 3 })
    await make('Fresh', { lastVisitDaysAgo: null, joinedDaysAgo: 1, endsIn: 29 })
    await make('Lapsed', { lastVisitDaysAgo: 40, joinedDaysAgo: 300, endsIn: -5 })
    await db.due.create({ data: { gymId: G.gym.id, athleteId: ids.Ending, amountPaise: 50000, dueDate: today, status: 'OPEN' } })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  const idsOf = async (audience: Parameters<typeof resolveAudience>[1]) => (await resolveAudience(db, audience, NOON)).map((m) => m.name.split(' ')[0]).sort()

  it('picks the right members for each group, branch and trainer', async () => {
    const all = await idsOf({ segment: 'all' })
    expect(all).toEqual(expect.arrayContaining(['Ending', 'Fresh', 'Idle', 'Regular']))
    expect(all).not.toContain('Lapsed')
    expect(await idsOf({ segment: 'inactive', days: 7 })).toEqual(['Idle'])
    expect(await idsOf({ segment: 'new', days: 7 })).toEqual(['Fresh'])
    expect(await idsOf({ segment: 'ending', days: 7 })).toEqual(['Ending'])
    expect(await idsOf({ segment: 'expired', days: 30 })).toEqual(['Lapsed'])
    expect(await idsOf({ segment: 'dues' })).toEqual(['Ending'])
    expect(await idsOf({ segment: 'regular' })).toEqual(['Regular'])
    expect(await idsOf({ segment: 'all', branchId: zirakpur })).toEqual(['Idle'])
    expect(await idsOf({ segment: 'all', trainerId: trainer })).toEqual(['Idle'])
    const [idle] = await resolveAudience(db, { segment: 'inactive', days: 7 }, NOON)
    expect(idle.idleDays).toBe(10)
  })

  it('preview counts and shows the line in the member language; nothing is saved', async () => {
    const preview = await previewBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, { segment: 'inactive', days: 7 }, { preset: 'miss_you', customText: null, channel: 'AUTO' }, NOON)
    expect(preview.count).toBe(1)
    expect(preview.whatsappNeeded).toBe(1)
    expect(preview.sample[0].line).toContain('10')
    expect(preview.sample[0].line).not.toMatch(/We have not seen/) // Punjabi member
    expect(await db.outboundMessage.count()).toBe(0)
  })

  it('a bulk send at night waits for 8 AM, then goes out once, in each language', async () => {
    const result = await sendBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, G.owner.id, { audience: { segment: 'all' }, message: { preset: 'challenge', customText: null, channel: 'WHATSAPP' } }, NIGHT)
    expect(result.quiet).toBe(true)
    const rows = await db.outboundMessage.findMany({ where: { campaignId: result.id } })
    expect(rows.length).toBe(result.total)
    expect(rows.every((row) => row.sendAfter.toISOString() === ist('2026-11-24T08:00:00').toISOString())).toBe(true)

    const ctx = await loadMessagingContext(base, G.gym.id, transport)
    expect((await flushOutbox(base, G.gym.id, NIGHT, { ctx })).sent).toBe(0)
    const morning = ist('2026-11-24T08:05:00')
    const flushed = await flushOutbox(base, G.gym.id, morning, { ctx })
    expect(flushed.sent).toBe(result.total)
    expect(sent.filter((s) => s.template === 'kasrat_gym_update')).toHaveLength(result.total)
    // Running again sends nothing twice.
    expect((await flushOutbox(base, G.gym.id, morning, { ctx })).sent).toBe(0)
    const [campaign] = await recentCampaigns(db)
    expect(campaign.counts.sent).toBe(result.total)
  })

  it('own words go to everyone as typed; app-only sends skip members without the app', async () => {
    const before = sent.length
    const own = await sendBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, G.owner.id, { audience: { segment: 'ending', days: 7 }, message: { preset: null, customText: 'Gym open 6 AM to 1 PM on Sunday', channel: 'AUTO' } }, NOON)
    const ctx = await loadMessagingContext(base, G.gym.id, transport)
    await flushOutbox(base, G.gym.id, NOON, { ctx })
    expect(sent.slice(before).map((s) => s.params[2])).toEqual(['Gym open 6 AM to 1 PM on Sunday'])
    expect(own.total).toBe(1)

    const pushOnly = await sendBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, G.owner.id, { audience: { segment: 'regular' }, message: { preset: 'consistency', customText: null, channel: 'PUSH' } }, NOON)
    const result = await flushOutbox(base, G.gym.id, NOON, { ctx })
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect((await db.outboundMessage.findFirstOrThrow({ where: { campaignId: pushOnly.id } })).outcome).toBe('no_push')
  })

  it('a send can be stopped before it goes out', async () => {
    const queued = await sendBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, G.owner.id, { audience: { segment: 'all' }, message: { preset: 'welcome', customText: null, channel: 'AUTO' } }, NIGHT)
    expect((await cancelBroadcast(db, queued.id)).cancelled).toBe(queued.total)
    const ctx = await loadMessagingContext(base, G.gym.id, transport)
    expect((await flushOutbox(base, G.gym.id, ist('2026-11-24T09:00:00'), { ctx })).sent).toBe(0)
  })

  it('automatic rules queue matching members once, then wait for the gap', async () => {
    const rule = await createRule(db, G.gym.id, G.owner.id, ruleSchema.parse({ name: 'Bring back', audience: { segment: 'inactive', days: 7 }, message: { preset: 'miss_you', channel: 'WHATSAPP' }, cooldownDays: 14 }))
    const day1 = ist('2026-11-24T10:00:00')
    expect(await runAutoRules(base, { id: G.gym.id, name: 'Bulk Gym' }, day1)).toEqual([{ ruleId: rule.id, queued: 1 }])
    const ctx = await loadMessagingContext(base, G.gym.id, transport)
    expect((await flushOutbox(base, G.gym.id, day1, { ctx })).sent).toBe(1)
    // Next morning the same member still matches but is inside the 14-day gap.
    expect(await runAutoRules(base, { id: G.gym.id, name: 'Bulk Gym' }, ist('2026-11-25T10:00:00'))).toEqual([{ ruleId: rule.id, queued: 0 }])
    await db.autoRule.updateMany({ where: { id: rule.id }, data: { enabled: false } })
    expect(await runAutoRules(base, { id: G.gym.id, name: 'Bulk Gym' }, ist('2026-12-20T10:00:00'))).toEqual([])
  })

  it('rejects a branch or trainer from another gym', async () => {
    const other = await makeGym(base, 'Other')
    try {
      await expect(previewBroadcast(base, { id: G.gym.id, name: 'Bulk Gym' }, { segment: 'all', branchId: other.branch.id }, { preset: 'welcome', customText: null, channel: 'AUTO' }, NOON)).rejects.toThrow(/not part of this gym/)
    } finally {
      await purgeGymData(base, other.gym.id)
    }
  })
})
