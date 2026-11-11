import { gymRoute, ok } from '@/lib/api/guard'
import { attendanceSettingsSchema } from '@/lib/validation/attendance'
import { parseGymSettings } from '@/lib/gym/settings'
import { audit } from '@/lib/audit'

// PATCH /api/gym/attendance/settings - which check-in methods this gym uses.
export const PATCH = gymRoute({ permission: 'settings.manage', schema: attendanceSettingsSchema }, async ({ db, gym, input, staff, meta }) => {
  const row = await db.gym.findFirstOrThrow({ select: { settings: true } })
  const current = parseGymSettings(row.settings)
  await db.gym.update({ where: { id: gym.id }, data: { settings: { ...current, attendance: input } } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'settings.attendance', entity: 'Gym', entityId: gym.id, meta: { before: current.attendance, after: input }, ip: meta.ip })
  return ok({ ok: true })
})
