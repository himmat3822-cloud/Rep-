import { gymRoute, ok } from '@/lib/api/guard'
import { gymAppSettingsSchema } from '@/lib/validation/owner'
import { parseGymSettings } from '@/lib/gym/settings'
import { audit } from '@/lib/audit'

// PATCH /api/gym/settings/app - how Rep+ behaves for this gym
export const PATCH = gymRoute({ permission: 'settings.manage', schema: gymAppSettingsSchema }, async ({ db, gym, input, staff, meta }) => {
  const row = await db.gym.findFirst({ select: { settings: true, ownerHandlesDesk: true } })
  const current = parseGymSettings(row?.settings)
  const settings = {
    ...current,
    thresholds: { regularVisitsPerWeek: input.regularVisitsPerWeek, slippingAfterDays: input.slippingAfterDays, inactiveAfterDays: input.inactiveAfterDays },
    features: { leaderboard: input.leaderboard, challenges: input.challenges, progressPhotos: input.progressPhotos },
    renewEarlyDiscountPct: input.renewEarlyDiscountPct,
    referralRewardDays: input.referralRewardDays,
    invoicePrefix: input.invoicePrefix,
    memberUpiId: input.memberUpiId || undefined,
    invoiceFooter: input.invoiceFooter || undefined,
  }
  await db.gym.update({
    where: { id: gym.id },
    data: { athleteLabel: input.athleteLabel, athleteLabelPlural: input.athleteLabelPlural, defaultLanguage: input.defaultLanguage, ownerHandlesDesk: input.ownerHandlesDesk, sessionMinutes: input.sessionMinutes, settings },
  })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'settings.app', entity: 'Gym', entityId: gym.id, meta: { ownerHandlesDesk: { from: row?.ownerHandlesDesk, to: input.ownerHandlesDesk }, athleteLabel: input.athleteLabel }, ip: meta.ip })
  return ok({ ok: true })
})
