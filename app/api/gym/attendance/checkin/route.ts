import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { manualCheckinSchema } from '@/lib/validation/attendance'
import { recordCheckIn } from '@/lib/attendance/checkin'
import { afterCheckIn } from '@/lib/athlete/badge-rules'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'

// POST /api/gym/attendance/checkin { athleteId, branchId? } - manual desk check-in (search + tap).
export const POST = gymRoute({ permission: 'attendance.checkin', schema: manualCheckinSchema }, async ({ db, gym, input, staff }) => {
  const config = await loadGymConfig(db, gym.id)
  const methods = enabledMethods(config.settings.attendance, config.features)
  requireMethod(methods.manual, 'Manual check-in')
  const athlete = await db.athlete.findFirst({ where: { id: input.athleteId }, select: { homeBranchId: true } })
  if (!athlete) throw new ApiError(404, 'NOT_FOUND', 'Member not found')
  const summary = await recordCheckIn(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: config.rawSettings }, {
    athleteId: input.athleteId,
    branchId: input.branchId ?? staff?.bid ?? athlete.homeBranchId,
    method: 'MANUAL',
    recordedById: staff?.sub ?? null,
    allowWithoutPlan: methods.manualAllowWithoutPlan,
    crossBranchFeature: config.features.includes('cross_branch_access'),
  })
  if (summary.status === 'checked_in') await afterCheckIn(db, { id: gym.id, slug: gym.slug }, summary.athlete.id)
  return ok(summary)
})
