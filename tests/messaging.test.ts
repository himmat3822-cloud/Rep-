import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEMPLATES, cleanParam, dueNote, metaTemplateDefinitions, renderTemplate, templateBody, type TemplateName } from '@/lib/messaging/templates'
import { isQuietHour, monthKey, quotaCeiling, usagePercent } from '@/lib/messaging/policy'
import { payToken, verifyPayToken } from '@/lib/messaging/pay-link'
import { pickDueStages, runDueReminders, sendDueReminderNow, type StageRow } from '@/lib/messaging/dues'
import { applyWhatsAppWebhook, nextStatus, optCommand, parseWebhook, verifyMetaSignature } from '@/lib/messaging/webhook'
import { generateMotivationForGym, isSafeLine, parseLines } from '@/lib/messaging/motivation'
import { favouriteHour, isSameDayOfYear, progressLine, reportWeekFor, runWishes, slotTargets } from '@/lib/messaging/scheduled'
import { checkQuotaWarnings, reserveMessage } from '@/lib/messaging/quota'
import { loadMessagingContext, sendGymMessage, type Transport } from '@/lib/messaging/send'
import { claimJob, runMessageJobs } from '@/lib/messaging/jobs'
import { parseGymSettings } from '@/lib/gym/settings'
import { reminderSettingsSchema } from '@/lib/validation/messaging'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

// IST = UTC + 5:30
const ist = (iso: string) => new Date(Date.parse(`${iso}+05:30`))
const TEN_AM = ist('2026-11-10T10:00:00')

describe('WhatsApp templates', () => {
  it('every template exists in English, Hindi and Punjabi with the same placeholders', () => {
    for (const name of Object.keys(TEMPLATES) as TemplateName[]) {
      const count = TEMPLATES[name].params.length
      for (const lang of ['EN', 'HI', 'PA'] as const) {
        const body = templateBody(name, lang)
        const used = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))
        expect(used.size, `${name} ${lang}`).toBe(count)
        for (let i = 1; i <= count; i += 1) expect(used.has(i), `${name} ${lang} {{${i}}}`).toBe(true)
        // Meta rejects templates that start or end with a variable.
        expect(body.startsWith('{{')).toBe(false)
        expect(body.endsWith('}}')).toBe(false)
      }
    }
    expect(metaTemplateDefinitions()).toHaveLength(Object.keys(TEMPLATES).length * 3)
  })

  it('renders parameters and cleans what WhatsApp would reject', () => {
    expect(cleanParam('line one\nline two\t  end   ')).toBe('line one line two end')
    expect(cleanParam('   ')).toBe('-')
    const text = renderTemplate('kasrat_birthday', 'EN', ['Arjun', 'Forge Fitness'])
    expect(text).toContain('Happy birthday, Arjun!')
    expect(text).toContain('Forge Fitness')
    expect(renderTemplate('kasrat_birthday', 'HI', ['Arjun', 'Forge'])).toContain('Arjun')
  })

  it('uses the owner note when set, else the default for the tone and language', () => {
    expect(dueNote('kasrat_due_soft', 'EN', 'friendly', 'Pay at the desk or on UPI')).toBe('Pay at the desk or on UPI')
    expect(dueNote('kasrat_due_today', 'EN', 'firm')).toMatch(/today/)
    expect(dueNote('kasrat_due_followup', 'HI', 'friendly')).not.toBe(dueNote('kasrat_due_followup', 'EN', 'friendly'))
  })
})

describe('messaging policy', () => {
  it('quiet hours are 9 PM to 8 AM IST', () => {
    expect(isQuietHour(ist('2026-11-10T20:59:00'))).toBe(false)
    expect(isQuietHour(ist('2026-11-10T21:00:00'))).toBe(true)
    expect(isQuietHour(ist('2026-11-11T07:59:00'))).toBe(true)
    expect(isQuietHour(ist('2026-11-11T08:00:00'))).toBe(false)
  })

  it('months and quota ceilings follow IST and priority', () => {
    expect(monthKey(ist('2026-11-01T00:30:00'))).toBe('2026-11')
    expect(monthKey(ist('2026-10-31T23:59:00'))).toBe('2026-10')
    expect(quotaCeiling(500, 'normal')).toBe(500)
    expect(quotaCeiling(500, 'low')).toBe(450)
    expect(quotaCeiling(500, 'critical')).toBe(Number.POSITIVE_INFINITY)
    expect(usagePercent(400, 500)).toBe(80)
    expect(usagePercent(3, 0)).toBe(100)
  })

  it('pay links are signed and tamper-proof', () => {
    const token = payToken('cmduetest000001')
    expect(verifyPayToken(token)).toBe('cmduetest000001')
    expect(verifyPayToken(token.replace('cmduetest000001', 'cmduetest000002'))).toBeNull()
    expect(verifyPayToken('nonsense')).toBeNull()
  })

  it('validates reminder settings: stages in date order, one-line notes', () => {
    const base = { duesAuto: true, tone: 'friendly', sendHour: 10, renewalReminders: true, renewalDays: [7], slotReminders: true, birthdayWishes: true, anniversaryWishes: true, weeklyReport: true, dailyMotivation: true }
    const stage = (offsetDays: number, extra: Record<string, unknown> = {}) => ({ name: 'Stage', offsetDays, template: 'kasrat_due_soft', customText: '', enabled: true, ...extra })
    expect(reminderSettingsSchema.safeParse({ ...base, stages: [stage(-3), stage(0)] }).success).toBe(true)
    expect(reminderSettingsSchema.safeParse({ ...base, stages: [stage(0), stage(-3)] }).success).toBe(false)
    expect(reminderSettingsSchema.safeParse({ ...base, stages: [stage(0, { customText: 'two\nlines' })] }).success).toBe(false)
    expect(reminderSettingsSchema.safeParse({ ...base, sendHour: 22, stages: [stage(0)] }).success).toBe(false)
  })
})

describe('dues reminder stages', () => {
  const stages: StageRow[] = [
    { stage: 1, name: 'Soft', offsetDays: -3, template: 'kasrat_due_soft', customText: null, notifyOwner: false, enabled: true },
    { stage: 2, name: 'Today', offsetDays: 0, template: 'kasrat_due_today', customText: null, notifyOwner: false, enabled: true },
    { stage: 3, name: 'Follow-up', offsetDays: 3, template: 'kasrat_due_followup', customText: null, notifyOwner: false, enabled: true },
    { stage: 4, name: 'Owner', offsetDays: 5, template: 'kasrat_due_owner_alert', customText: null, notifyOwner: true, enabled: true },
  ]

  it('picks the right stage for the day, never repeats, and catches up only the latest', () => {
    expect(pickDueStages(stages, 0, -5)).toEqual({ member: null, owner: null })
    expect(pickDueStages(stages, 0, -3).member?.stage).toBe(1)
    expect(pickDueStages(stages, 1, -2)).toEqual({ member: null, owner: null })
    expect(pickDueStages(stages, 1, 0).member?.stage).toBe(2)
    // Missed days: jump straight to the latest member stage, plus the owner alert.
    const late = pickDueStages(stages, 0, 6)
    expect(late.member?.stage).toBe(3)
    expect(late.owner?.stage).toBe(4)
    expect(pickDueStages(stages, 4, 20)).toEqual({ member: null, owner: null })
  })

  it('skips switched-off stages', () => {
    const off = stages.map((s) => (s.stage === 2 ? { ...s, enabled: false } : s))
    expect(pickDueStages(off, 1, 0)).toEqual({ member: null, owner: null })
  })
})

describe('scheduled message helpers', () => {
  it('wishes Feb 29 birthdays on Feb 28 in other years', () => {
    const leapling = new Date(Date.UTC(2000, 1, 29))
    expect(isSameDayOfYear(leapling, { year: 2027, month: 1, day: 28 })).toBe(true)
    expect(isSameDayOfYear(leapling, { year: 2028, month: 1, day: 28 })).toBe(false)
    expect(isSameDayOfYear(leapling, { year: 2028, month: 1, day: 29 })).toBe(true)
  })

  it('slot reminders: next hour by day, early slots the evening before, nothing in quiet hours', () => {
    expect(slotTargets(ist('2026-11-10T17:00:00'))).toEqual([{ date: new Date(Date.UTC(2026, 10, 10)), hours: [18], tomorrow: false }])
    const evening = slotTargets(ist('2026-11-10T19:00:00'))
    expect(evening).toHaveLength(2)
    expect(evening[1]).toMatchObject({ date: new Date(Date.UTC(2026, 10, 11)), tomorrow: true })
    expect(evening[1].hours).toContain(6)
    expect(slotTargets(ist('2026-11-10T22:00:00'))).toEqual([])
  })

  it('weekly report week: Sunday evening or Monday morning', () => {
    expect(reportWeekFor(ist('2026-11-15T18:30:00'))).toEqual(new Date(Date.UTC(2026, 10, 9)))
    expect(reportWeekFor(ist('2026-11-16T10:00:00'))).toEqual(new Date(Date.UTC(2026, 10, 9)))
    expect(reportWeekFor(ist('2026-11-15T12:00:00'))).toBeNull()
    expect(reportWeekFor(ist('2026-11-12T19:00:00'))).toBeNull()
  })

  it('favourite time and a progress line that never shames', () => {
    expect(favouriteHour([18, 7, 18, 19])).toBe(18)
    expect(favouriteHour([])).toBeNull()
    expect(progressLine('EN', 80, 78.8)).toBe('Body weight -1.2 kg in 4 weeks.')
    expect(progressLine('EN', null, null)).toMatch(/Log your progress/)
    expect(progressLine('EN', 70, 70)).toMatch(/steady/)
  })
})

describe('motivation lines', () => {
  it('parses JSON arrays and numbered lists', () => {
    expect(parseLines('Sure! ["One more rep today, chalo!", "Show up and shine."]')).toEqual(['One more rep today, chalo!', 'Show up and shine.'])
    expect(parseLines('1. First line here\n2) Second line here\n- Third')).toEqual(['First line here', 'Second line here', 'Third'])
    expect(parseLines(null)).toEqual([])
  })

  it('rejects body shaming, links and junk', () => {
    expect(isSafeLine('Burn that fat today, no excuses!', 'EN')).toBe(false)
    expect(isSafeLine('Visit https://x.com for more energy!', 'EN')).toBe(false)
    expect(isSafeLine('Hi', 'EN')).toBe(false)
    expect(isSafeLine('Fatigue is temporary, pride is forever.', 'EN')).toBe(true)
    expect(isSafeLine('Show up today and make it count!', 'HI')).toBe(true)
  })
})

describe('WhatsApp webhook parsing', () => {
  it('verifies the Meta signature over the raw body', () => {
    const body = '{"entry":[]}'
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`
    expect(verifyMetaSignature(body, sig, 'app-secret')).toBe(true)
    expect(verifyMetaSignature(body, sig, 'other-secret')).toBe(false)
    expect(verifyMetaSignature(body + ' ', sig, 'app-secret')).toBe(false)
    expect(verifyMetaSignature(body, null, 'app-secret')).toBe(false)
  })

  it('reads statuses and replies, and statuses never move backwards', () => {
    const parsed = parseWebhook({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1762750000' }, { id: 'wamid.2', status: 'failed', timestamp: '1762750000', errors: [{ code: 131026, title: 'Undeliverable' }] }], messages: [{ id: 'in.1', from: '919876511111', text: { body: ' stop ' } }] } }] }],
    })
    expect(parsed.statuses).toHaveLength(2)
    expect(parsed.statuses[1].error).toBe('131026 Undeliverable')
    expect(parsed.messages[0]).toMatchObject({ from: '919876511111' })
    expect(nextStatus('SENT', 'delivered')).toBe('DELIVERED')
    expect(nextStatus('READ', 'delivered')).toBeNull()
    expect(nextStatus('DELIVERED', 'failed')).toBeNull()
    expect(nextStatus('SENT', 'failed')).toBe('FAILED')
    expect(optCommand(' stop ')).toBe('stop')
    expect(optCommand('START')).toBe('start')
    expect(optCommand('stop sending me this')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Database tests
// ---------------------------------------------------------------------------

describe('quota, sending and the dues engine (database)', () => {
  const db = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  const sent: { to: string; template: string }[] = []
  const transport: Transport = async (message) => {
    sent.push({ to: message.to, template: message.template })
    return { providerId: `wamid.${uniq('t')}`, skipped: false }
  }
  const failing: Transport = async () => {
    throw new Error('WhatsApp send failed: invalid number')
  }

  beforeAll(async () => {
    G = await makeGym(db, 'Msg')
    const plan = await db.platformPlan.upsert({
      where: { code: 'msg-plan' },
      create: { code: 'msg-plan', name: 'Msg', monthlyPricePaise: 10000, annualPricePaise: 100000, branchLimit: 1, whatsappQuota: 10, features: ['dues_reminders', 'birthday_wishes', 'slot_booking'] },
      update: { whatsappQuota: 10, features: ['dues_reminders', 'birthday_wishes', 'slot_booking'] },
    })
    await db.gymSubscription.create({ data: { gymId: G.gym.id, planId: plan.id, status: 'ACTIVE' } })
    await db.reminderStage.createMany({
      data: [
        { gymId: G.gym.id, stage: 1, name: 'Soft', offsetDays: -3, template: 'kasrat_due_soft' },
        { gymId: G.gym.id, stage: 2, name: 'Today', offsetDays: 0, template: 'kasrat_due_today' },
        { gymId: G.gym.id, stage: 3, name: 'Follow-up', offsetDays: 3, template: 'kasrat_due_followup' },
        { gymId: G.gym.id, stage: 4, name: 'Owner', offsetDays: 5, template: 'kasrat_due_owner_alert', notifyOwner: true },
      ],
    })
  })

  afterAll(async () => {
    await purgeGymData(db, G.gym.id)
  })

  const gymInfo = () => ({ id: G.gym.id, name: G.gym.name, slug: G.gym.slug, messaging: parseGymSettings({}).messaging })

  it('counts quota atomically: low priority stops at 90%, normal at 100%, critical never', async () => {
    const other = await makeGym(db, 'Quota')
    try {
      const results: boolean[] = []
      for (let i = 0; i < 12; i += 1) results.push((await reserveMessage(db, other.gym.id, 10, 'low', TEN_AM)).ok)
      expect(results.filter(Boolean)).toHaveLength(9)
      expect((await reserveMessage(db, other.gym.id, 10, 'normal', TEN_AM)).ok).toBe(true)
      expect((await reserveMessage(db, other.gym.id, 10, 'normal', TEN_AM)).ok).toBe(false)
      expect((await reserveMessage(db, other.gym.id, 10, 'critical', TEN_AM)).ok).toBe(true)
      const usage = await db.whatsAppUsage.findUniqueOrThrow({ where: { gymId_month: { gymId: other.gym.id, month: '2026-11' } } })
      expect(usage.sent).toBe(11)
      expect(usage.blocked).toBe(4)

      // Warnings fire once each.
      expect(await checkQuotaWarnings(db, other.gym.id, 10, 8, false, TEN_AM)).toBe('warned80')
      expect(await checkQuotaWarnings(db, other.gym.id, 10, 9, false, TEN_AM)).toBeNull()
      expect(await checkQuotaWarnings(db, other.gym.id, 10, 10, true, TEN_AM)).toBe('warned100')
      expect(await checkQuotaWarnings(db, other.gym.id, 10, 10, true, TEN_AM)).toBeNull()
      expect(await db.notification.count({ where: { gymId: other.gym.id } })).toBe(2)
    } finally {
      await purgeGymData(db, other.gym.id)
    }
  })

  it('send pipeline: dedupe, quiet hours, opt-out, failures refund the quota', async () => {
    const ctx = await loadMessagingContext(db, G.gym.id, transport)
    const message = { template: 'kasrat_birthday' as const, language: 'EN' as const, params: ['Asha', 'Msg Gym'], to: { phone: G.athlete.phone, athleteId: G.athlete.id }, purpose: 'birthday', dedupeKey: `test:${uniq('d')}` }
    expect((await sendGymMessage(db, ctx, message, TEN_AM)).outcome).toBe('sent')
    expect((await sendGymMessage(db, ctx, message, TEN_AM)).outcome).toBe('duplicate')
    expect((await sendGymMessage(db, ctx, { ...message, dedupeKey: 'quiet' }, ist('2026-11-10T22:00:00'))).outcome).toBe('quiet_hours')
    expect((await sendGymMessage(db, ctx, { ...message, dedupeKey: 'optout', to: { ...message.to, optedOut: true } }, TEN_AM)).outcome).toBe('opted_out')
    expect(await db.messageLog.count({ where: { gymId: G.gym.id, dedupeKey: { in: ['quiet', 'optout'] } } })).toBe(0)

    const before = (await db.whatsAppUsage.findUniqueOrThrow({ where: { gymId_month: { gymId: G.gym.id, month: '2026-11' } } })).sent
    const failed = await sendGymMessage(db, { ...ctx, transport: failing }, { ...message, dedupeKey: 'fails' }, TEN_AM)
    expect(failed.outcome).toBe('failed')
    const log = await db.messageLog.findUniqueOrThrow({ where: { id: failed.logId } })
    expect(log).toMatchObject({ status: 'FAILED', dedupeKey: null })
    expect((await db.whatsAppUsage.findUniqueOrThrow({ where: { gymId_month: { gymId: G.gym.id, month: '2026-11' } } })).sent).toBe(before)

    const paused = await sendGymMessage(db, { ...ctx, status: 'SUSPENDED' }, { ...message, dedupeKey: 'paused' }, TEN_AM)
    expect(paused.outcome).toBe('paused')
  })

  it('dues engine: each stage once, catch-up, owner alert, stops when paid', async () => {
    const ctx = await loadMessagingContext(db, G.gym.id, transport)
    // Reset usage so this test has quota to work with.
    await db.whatsAppUsage.deleteMany({ where: { gymId: G.gym.id } })
    const dueDate = new Date(Date.UTC(2026, 10, 13)) // 13 Nov
    const due = await db.due.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 150000, dueDate, status: 'OPEN' } })
    sent.length = 0

    // 10 Nov = 3 days before -> soft reminder
    let summary = await runDueReminders(db, ctx, gymInfo(), TEN_AM)
    expect(summary.sent).toBe(1)
    expect(sent[0]).toMatchObject({ to: G.athlete.phone, template: 'kasrat_due_soft' })
    const afterSoft = await db.due.findUniqueOrThrow({ where: { id: due.id } })
    expect(afterSoft.reminderStage).toBe(1)
    expect(afterSoft.paymentLinkUrl).toContain('/p/')

    // Same day again: nothing new.
    summary = await runDueReminders(db, ctx, gymInfo(), new Date(TEN_AM.getTime() + 3600000))
    expect(summary.sent).toBe(0)

    // 19 Nov = 6 days late (cron was down): follow-up + owner alert, not the "today" stage.
    sent.length = 0
    summary = await runDueReminders(db, ctx, gymInfo(), ist('2026-11-19T10:00:00'))
    expect(sent.map((s) => s.template).sort()).toEqual(['kasrat_due_followup', 'kasrat_due_owner_alert'])
    expect(summary.ownerAlerts).toBe(1)
    expect((await db.due.findUniqueOrThrow({ where: { id: due.id } })).reminderStage).toBe(4)
    expect(await db.notification.count({ where: { gymId: G.gym.id, recipientId: G.owner.id } })).toBeGreaterThan(0)

    // Manual reminder: once a day.
    sent.length = 0
    expect((await sendDueReminderNow(db, ctx, gymInfo(), due.id, ist('2026-11-20T11:00:00'))).outcome).toBe('sent')
    expect((await sendDueReminderNow(db, ctx, gymInfo(), due.id, ist('2026-11-20T15:00:00'))).outcome).toBe('duplicate')
    expect((await sendDueReminderNow(db, ctx, gymInfo(), due.id, ist('2026-11-20T22:00:00'))).outcome).toBe('quiet_hours')

    // Paid: no more reminders, manual or automatic.
    await db.due.update({ where: { id: due.id }, data: { status: 'PAID', paidAt: new Date() } })
    const second = await db.due.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, amountPaise: 50000, dueDate: new Date(Date.UTC(2026, 10, 30)), status: 'PAID' } })
    sent.length = 0
    await runDueReminders(db, ctx, gymInfo(), ist('2026-11-30T10:00:00'))
    expect(sent).toHaveLength(0)
    expect((await sendDueReminderNow(db, ctx, gymInfo(), second.id, ist('2026-11-30T10:00:00'))).outcome).toBe('not_open')
  })

  it('webhook receipts update the log in order, refund failures, and STOP opts out', async () => {
    const ctx = await loadMessagingContext(db, G.gym.id, transport)
    const result = await sendGymMessage(db, ctx, { template: 'kasrat_birthday', language: 'EN', params: ['A', 'B'], to: { phone: G.athlete.phone, athleteId: G.athlete.id }, purpose: 'birthday', dedupeKey: uniq('wh') }, TEN_AM)
    const log = await db.messageLog.findUniqueOrThrow({ where: { id: result.logId } })
    const wamid = log.providerId!
    const statusPayload = (status: string, ts: number) => ({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status, timestamp: String(ts) }] } }] }] })

    await applyWhatsAppWebhook(db, statusPayload('read', 1762760000))
    await applyWhatsAppWebhook(db, statusPayload('delivered', 1762750000)) // late receipt
    await applyWhatsAppWebhook(db, statusPayload('read', 1762760000)) // replayed
    const after = await db.messageLog.findUniqueOrThrow({ where: { id: log.id } })
    expect(after.status).toBe('READ')
    expect(after.readAt?.getTime()).toBe(1762760000 * 1000)

    const failedSend = await sendGymMessage(db, ctx, { template: 'kasrat_birthday', language: 'EN', params: ['A', 'B'], to: { phone: G.athlete.phone }, purpose: 'birthday', dedupeKey: uniq('wh') }, TEN_AM)
    const failedLog = await db.messageLog.findUniqueOrThrow({ where: { id: failedSend.logId } })
    const usageBefore = (await db.whatsAppUsage.findUniqueOrThrow({ where: { gymId_month: { gymId: G.gym.id, month: '2026-11' } } })).sent
    await applyWhatsAppWebhook(db, { entry: [{ changes: [{ value: { statuses: [{ id: failedLog.providerId, status: 'failed', timestamp: '1762750000', errors: [{ code: 131026, title: 'Undeliverable' }] }] } }] }] })
    expect((await db.messageLog.findUniqueOrThrow({ where: { id: failedLog.id } })).status).toBe('FAILED')
    expect((await db.whatsAppUsage.findUniqueOrThrow({ where: { gymId_month: { gymId: G.gym.id, month: '2026-11' } } })).sent).toBe(usageBefore - 1)

    const from = G.athlete.phone.replace('+', '')
    const stop = await applyWhatsAppWebhook(db, { entry: [{ changes: [{ value: { messages: [{ id: uniq('in'), from, text: { body: 'STOP' } }] } }] }] })
    expect(stop.optOuts).toBe(1)
    expect((await db.athlete.findUniqueOrThrow({ where: { id: G.athlete.id } })).whatsappOptOut).toBe(true)
    await applyWhatsAppWebhook(db, { entry: [{ changes: [{ value: { messages: [{ id: uniq('in'), from, text: { body: 'start' } }] } }] }] })
    expect((await db.athlete.findUniqueOrThrow({ where: { id: G.athlete.id } })).whatsappOptOut).toBe(false)
  })

  it('wishes and the job runner run once per day', async () => {
    await db.athlete.update({ where: { id: G.athlete.id }, data: { dateOfBirth: new Date(Date.UTC(1995, 10, 10)) } })
    const ctx = await loadMessagingContext(db, G.gym.id, transport)
    sent.length = 0
    const wishes = await runWishes(db, ctx, gymInfo(), TEN_AM)
    expect(wishes.birthdays.sent + wishes.birthdays.skipped).toBe(1)

    expect(await claimJob(db, `test:${G.gym.id}`)).toBe(true)
    expect(await claimJob(db, `test:${G.gym.id}`)).toBe(false)

    const first = await runMessageJobs(db, ist('2026-11-11T10:30:00'), { gymIds: [G.gym.id], transport })
    expect(first[0].dues).toBeDefined()
    const second = await runMessageJobs(db, ist('2026-11-11T11:30:00'), { gymIds: [G.gym.id], transport })
    expect(second[0].dues).toBeUndefined()
    expect(second[0].wishes).toBeUndefined()
    const night = await runMessageJobs(db, ist('2026-11-12T23:00:00'), { gymIds: [G.gym.id], transport })
    expect(night[0].dues).toBeUndefined()
    await db.jobRun.deleteMany({ where: { key: { contains: G.gym.id } } })
  })

  it('motivation: one line per member per day, Groq lines when safe, static otherwise', async () => {
    await db.membership.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, planId: 'none', status: 'ACTIVE', startsAt: new Date(Date.UTC(2026, 9, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)), pricePaise: 100 } })
    const fromGroq = await generateMotivationForGym(db, { id: G.gym.id, name: G.gym.name }, TEN_AM, async () => '["Chalo, one more strong session today!", "Show up, sweat it out, feel proud.", "Your streak is your superpower."]')
    expect(fromGroq).toMatchObject({ created: 1, groq: 1 })
    const again = await generateMotivationForGym(db, { id: G.gym.id, name: G.gym.name }, TEN_AM, async () => null)
    expect(again.created).toBe(0)
    const tomorrow = await generateMotivationForGym(db, { id: G.gym.id, name: G.gym.name }, new Date(TEN_AM.getTime() + 86400000), async () => '["Burn the fat, lazy bones!"]')
    expect(tomorrow).toMatchObject({ created: 1, static: 1 })
  })
})
