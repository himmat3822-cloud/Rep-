import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { hitRateLimit } from '@/lib/rate-limit'
import { selfCheckinSchema } from '@/lib/validation/attendance'
import { insideGeofence, verifyEntranceSignature } from '@/lib/attendance/qr'
import { recordCheckIn } from '@/lib/attendance/checkin'
import { afterCheckIn } from '@/lib/athlete/badge-rules'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'

// POST /api/g/{slug}/checkin { branchId, sig?, lat?, lng?, accuracy? }
// Member self check-in. Depending on the owner's settings it needs the
// entrance QR (sig), being inside the branch geofence, or both.
export const POST = gymRoute({ allow: ['athlete'], schema: selfCheckinSchema }, async ({ db, gym, athlete, input }) => {
  if (!athlete) throw errors.forbidden()
  const limit = await hitRateLimit(prisma, `self-checkin:${athlete.sub}`, 6, 60)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const config = await loadGymConfig(db, gym.id)
  const methods = enabledMethods(config.settings.attendance, config.features)
  requireMethod(methods.selfCheckin, 'Self check-in')

  const branch = await db.branch.findFirst({ where: { id: input.branchId, archived: false } })
  if (!branch) throw errors.notFound('Branch')
  if (methods.selfRequireEntranceQr && !verifyEntranceSignature(branch.id, branch.entranceQrSecret, input.sig)) {
    throw new ApiError(422, 'CHECKIN_BLOCKED', 'Scan the Rep+ QR poster at the gym entrance to check in.')
  }
  if (methods.selfRequireLocation) {
    if (branch.latitude === null || branch.longitude === null) throw new ApiError(422, 'CHECKIN_BLOCKED', 'The gym has not set its location yet. Please check in at the desk.')
    if (input.lat === undefined || input.lng === undefined) throw new ApiError(422, 'CHECKIN_BLOCKED', 'Allow location access so we can confirm you are at the gym.')
    const fence = insideGeofence({ latitude: branch.latitude, longitude: branch.longitude, geofenceMeters: branch.geofenceMeters }, { lat: input.lat, lng: input.lng, accuracy: input.accuracy })
    if (!fence.inside) throw new ApiError(422, 'CHECKIN_BLOCKED', `You seem to be ${fence.distance} m away from ${branch.name}. Check in when you reach the gym.`)
  }
  const summary = await recordCheckIn(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: config.rawSettings }, {
    athleteId: athlete.sub,
    branchId: branch.id,
    method: input.sig ? 'QR_ENTRANCE' : 'GEO_SELF',
    crossBranchFeature: config.features.includes('cross_branch_access'),
  })
  // Members only see their own summary; dues stay private (shown only to them).
  if (summary.status === 'checked_in') await afterCheckIn(db, { id: gym.id, slug: gym.slug }, summary.athlete.id)
  return ok(summary)
})
