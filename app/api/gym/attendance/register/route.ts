import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { registerSchema } from '@/lib/validation/attendance'
import { recordCheckIn } from '@/lib/attendance/checkin'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'
import { audit } from '@/lib/audit'

// POST /api/gym/attendance/register { branchId, date, entries: [{ athleteId, hour }] }
// Copies a day of the paper register into Rep+ (up to 60 days back).
export const POST = gymRoute({ permission: 'attendance.checkin', schema: registerSchema }, async ({ db, gym, input, staff, meta }) => {
  const config = await loadGymConfig(db, gym.id)
  requireMethod(enabledMethods(config.settings.attendance, config.features).manual, 'The manual register')
  const dayStart = new Date(`${input.date}T00:00:00+05:30`)
  const ageDays = (Date.now() - dayStart.getTime()) / 86400000
  if (ageDays < 0 || ageDays > 60) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a date within the last 60 days')
  let created = 0
  let skipped = 0
  for (const entry of input.entries) {
    const at = new Date(dayStart.getTime() + entry.hour * 3600000 + 5 * 60000)
    if (at.getTime() > Date.now()) {
      skipped += 1
      continue
    }
    try {
      const result = await recordCheckIn(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: config.rawSettings }, {
        athleteId: entry.athleteId,
        branchId: input.branchId,
        method: 'REGISTER',
        at,
        recordedById: staff?.sub ?? null,
        allowWithoutPlan: true,
        crossBranchFeature: true,
      })
      if (result.status === 'checked_in') created += 1
      else skipped += 1
    } catch {
      skipped += 1
    }
  }
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'attendance.register', entity: 'CheckIn', meta: { date: input.date, branchId: input.branchId, created, skipped }, ip: meta.ip })
  return ok({ created, skipped })
})
