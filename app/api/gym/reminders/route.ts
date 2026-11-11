import { gymRoute, ok } from '@/lib/api/guard'
import { reminderSettingsSchema } from '@/lib/validation/messaging'
import { parseGymSettings } from '@/lib/gym/settings'
import { DUE_OWNER_TEMPLATE } from '@/lib/messaging/templates'
import { audit } from '@/lib/audit'

// PUT /api/gym/reminders - message settings (Gym.settings.messaging) and
// the dues reminder stages, saved together. Stages are renumbered 1..n in
// date order.
export const PUT = gymRoute({ permission: 'reminders.manage', schema: reminderSettingsSchema }, async ({ db, gym, input, staff, meta }) => {
  const row = await db.gym.findFirstOrThrow({ select: { settings: true } })
  const current = parseGymSettings(row.settings)
  const { stages, ...messaging } = input
  const before = await db.reminderStage.findMany({ orderBy: { stage: 'asc' } })

  await db.$transaction(async (tx) => {
    await tx.gym.update({ where: { id: gym.id }, data: { settings: { ...current, messaging: { ...messaging, renewalDays: [...new Set(messaging.renewalDays)].sort((a, b) => b - a) } } } })
    await tx.reminderStage.deleteMany({})
    await tx.reminderStage.createMany({
      data: stages.map((stage, index) => ({
        gymId: gym.id,
        stage: index + 1,
        name: stage.name,
        offsetDays: stage.offsetDays,
        template: stage.template,
        customText: stage.customText ? stage.customText : null,
        notifyOwner: stage.template === DUE_OWNER_TEMPLATE,
        enabled: stage.enabled,
      })),
    })
  })

  await audit({
    gymId: gym.id,
    actorType: 'STAFF',
    actorId: staff!.sub,
    impersonatedBy: staff?.imp ?? null,
    action: 'settings.reminders',
    entity: 'Gym',
    entityId: gym.id,
    meta: { before: { messaging: current.messaging, stages: before.map((s) => ({ name: s.name, offsetDays: s.offsetDays, template: s.template, enabled: s.enabled })) }, after: input },
    ip: meta.ip,
  })
  return ok({ ok: true })
})
