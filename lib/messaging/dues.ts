import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { appUrl } from '@/lib/env'
import { formatInr } from '@/lib/money'
import { addDays, daysBetween, formatIstDate, istDateOnly } from '@/lib/time'
import type { MessagingSettings } from '@/lib/gym/settings'
import { DUE_MEMBER_TEMPLATES, DUE_OWNER_TEMPLATE, dueNote, firstName, type DueStageTemplate } from './templates'
import { payLinkUrl } from './pay-link'
import { sendGymMessage, type MessagingContext, type SendOutcome } from './send'

// Dues reminder engine. The owner configures the stages (Settings >
// Reminders). Default: soft 3 days before, friendly on the due date,
// follow-up 3 days after, owner alert 5 days after.
//  - each stage is sent at most once per due (dedupe key due:<id>:s<n>)
//  - a stage that was missed (cron down, quota hit) is caught up, but only
//    the latest one, so a member never gets three messages in one day
//  - only OPEN dues are looked at, so paying stops reminders instantly
//  - dues more than 30 days late are left to the owner ("Send now")

export const MAX_AUTO_DAYS_LATE = 30

export interface StageRow {
  stage: number
  name: string
  offsetDays: number
  template: string
  customText: string | null
  notifyOwner: boolean
  enabled: boolean
}

export function pickDueStages(stages: StageRow[], lastStage: number, daysFromDue: number): { member: StageRow | null; owner: StageRow | null } {
  const eligible = stages.filter((stage) => stage.enabled && stage.stage > lastStage && stage.offsetDays <= daysFromDue).sort((a, b) => a.stage - b.stage)
  const member = eligible.filter((stage) => !stage.notifyOwner).at(-1) ?? null
  const owner = eligible.filter((stage) => stage.notifyOwner).at(-1) ?? null
  return { member, owner }
}

export function memberTemplateFor(template: string, daysFromDue: number): DueStageTemplate {
  if ((DUE_MEMBER_TEMPLATES as readonly string[]).includes(template)) return template as DueStageTemplate
  return daysFromDue < 0 ? 'kasrat_due_soft' : daysFromDue === 0 ? 'kasrat_due_today' : 'kasrat_due_followup'
}

export interface DueRunGym {
  id: string
  name: string
  messaging: MessagingSettings
}

export interface DueRunSummary {
  checked: number
  sent: number
  ownerAlerts: number
  blocked: number
  failed: number
  stoppedBy?: SendOutcome
}

const shortDate = (date: Date) => formatIstDate(date, { day: 'numeric', month: 'short' })

export async function runDueReminders(base: PrismaClient, ctx: MessagingContext, gym: DueRunGym, now: Date = new Date()): Promise<DueRunSummary> {
  const db = scopeToGym(base, gym.id)
  const summary: DueRunSummary = { checked: 0, sent: 0, ownerAlerts: 0, blocked: 0, failed: 0 }
  const stages = await db.reminderStage.findMany({ orderBy: { stage: 'asc' } })
  const active = stages.filter((stage) => stage.enabled)
  if (active.length === 0) return summary

  const today = istDateOnly(now)
  const earliestOffset = Math.min(...active.map((stage) => stage.offsetDays))
  const dues = await db.due.findMany({
    where: { status: 'OPEN', dueDate: { gte: addDays(today, -MAX_AUTO_DAYS_LATE), lte: addDays(today, Math.max(0, -earliestOffset)) } },
    orderBy: { dueDate: 'asc' },
  })
  if (dues.length === 0) return summary

  const [athletes, owners] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: [...new Set(dues.map((due) => due.athleteId))] } }, select: { id: true, name: true, phone: true, memberCode: true, language: true, whatsappOptOut: true, archived: true } }),
    db.gymUser.findMany({ where: { kind: 'OWNER', active: true }, select: { id: true, name: true, phone: true, language: true } }),
  ])
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]))

  for (const due of dues) {
    const athlete = athleteById.get(due.athleteId)
    if (!athlete || athlete.archived) continue
    summary.checked += 1
    const daysFromDue = daysBetween(due.dueDate, today)
    const { member, owner } = pickDueStages(active, due.reminderStage, daysFromDue)
    let reached = due.reminderStage

    if (member) {
      const link = due.paymentLinkUrl ?? payLinkUrl(due.id)
      if (!due.paymentLinkUrl) await db.due.update({ where: { id: due.id }, data: { paymentLinkUrl: link } })
      const template = memberTemplateFor(member.template, daysFromDue)
      const result = await sendGymMessage(
        base,
        ctx,
        {
          template,
          language: athlete.language,
          params: [firstName(athlete.name), gym.name, formatInr(due.amountPaise), shortDate(due.dueDate), dueNote(template, athlete.language, gym.messaging.tone, member.customText), link],
          to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
          purpose: 'due_reminder',
          dedupeKey: `due:${due.id}:s${member.stage}`,
        },
        now,
      )
      if (result.outcome === 'quiet_hours' || result.outcome === 'paused') {
        summary.stoppedBy = result.outcome
        return summary
      }
      if (result.outcome === 'sent') summary.sent += 1
      if (result.outcome === 'quota') summary.blocked += 1
      if (result.outcome === 'failed') summary.failed += 1
      if (result.outcome === 'sent' || result.outcome === 'duplicate') reached = Math.max(reached, member.stage)
    }

    if (owner) {
      let anySent = false
      for (const person of owners) {
        const result = await sendGymMessage(
          base,
          ctx,
          {
            template: DUE_OWNER_TEMPLATE,
            language: person.language,
            params: [firstName(person.name), athlete.name, athlete.memberCode, formatInr(due.amountPaise), String(daysFromDue), `${appUrl()}/owner/payments?tab=dues`],
            to: { phone: person.phone, staffId: person.id },
            purpose: 'due_owner_alert',
            dedupeKey: `due:${due.id}:s${owner.stage}:${person.id}`,
          },
          now,
        )
        if (result.outcome === 'sent') anySent = true
        if (result.outcome === 'quota') summary.blocked += 1
        if (result.outcome === 'failed') summary.failed += 1
      }
      if (anySent || owners.length === 0) {
        await db.notification.createMany({
          data: owners.map((person) => ({
            gymId: gym.id,
            recipientType: 'STAFF' as const,
            recipientId: person.id,
            title: `${athlete.name} has not paid ${formatInr(due.amountPaise)}`,
            body: `${daysFromDue} days after the due date, even after reminders. A call may help.`,
            href: `/owner/members/${athlete.id}`,
          })),
        })
        summary.ownerAlerts += 1
      }
      // The owner stage counts as done once it was tried; the in-app alert is always there.
      reached = Math.max(reached, owner.stage)
    }

    if (reached > due.reminderStage) {
      await db.due.update({ where: { id: due.id }, data: { reminderStage: reached, lastRemindedAt: now } })
    }
  }
  return summary
}

// "Send reminder now" from the dues list. One manual reminder per due per day.
export async function sendDueReminderNow(base: PrismaClient, ctx: MessagingContext, gym: DueRunGym, dueId: string, now: Date = new Date()) {
  const db = scopeToGym(base, gym.id)
  const due = await db.due.findFirst({ where: { id: dueId } })
  if (!due) return { outcome: 'not_found' as const }
  if (due.status !== 'OPEN') return { outcome: 'not_open' as const }
  const athlete = await db.athlete.findFirst({ where: { id: due.athleteId }, select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true } })
  if (!athlete) return { outcome: 'not_found' as const }

  const today = istDateOnly(now)
  const daysFromDue = daysBetween(due.dueDate, today)
  const template = memberTemplateFor('', daysFromDue)
  const link = due.paymentLinkUrl ?? payLinkUrl(due.id)
  if (!due.paymentLinkUrl) await db.due.update({ where: { id: due.id }, data: { paymentLinkUrl: link } })
  const stageNote = (await db.reminderStage.findFirst({ where: { template, enabled: true }, select: { customText: true } }))?.customText ?? null

  const result = await sendGymMessage(
    base,
    ctx,
    {
      template,
      language: athlete.language,
      params: [firstName(athlete.name), gym.name, formatInr(due.amountPaise), shortDate(due.dueDate), dueNote(template, athlete.language, gym.messaging.tone, stageNote), link],
      to: { phone: athlete.phone, athleteId: athlete.id, optedOut: athlete.whatsappOptOut },
      purpose: 'due_manual',
      dedupeKey: `due:${due.id}:manual:${today.toISOString().slice(0, 10)}`,
    },
    now,
  )
  if (result.outcome === 'sent') await db.due.update({ where: { id: due.id }, data: { lastRemindedAt: now } })
  return { outcome: result.outcome, template, error: result.error }
}
