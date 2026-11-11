import { Prisma } from '@/lib/generated/prisma/client'
import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { scanSchema } from '@/lib/validation/attendance'
import { verifyQrToken } from '@/lib/attendance/qr'
import { recordCheckIn } from '@/lib/attendance/checkin'
import { afterCheckIn } from '@/lib/athlete/badge-rules'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'

// POST /api/gym/attendance/scan { token, branchId? } - desk scans a member's rotating QR.
export const POST = gymRoute({ permission: 'attendance.checkin', schema: scanSchema }, async ({ db, gym, input, staff }) => {
  const config = await loadGymConfig(db, gym.id)
  requireMethod(enabledMethods(config.settings.attendance, config.features).deskQr, 'QR check-in at the desk')
  const result = verifyQrToken(input.token, gym.id)
  if (!result.ok) {
    const message = result.reason === 'expired' ? 'This QR has expired. Ask them to open the app again.' : 'Not a Rep+ QR for this gym.'
    throw new ApiError(422, 'CHECKIN_BLOCKED', message)
  }
  try {
    await db.qrNonce.create({ data: { gymId: gym.id, nonce: `${result.athleteId}.${result.step}`, expiresAt: new Date(Date.now() + 10 * 60000) } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(422, 'CHECKIN_BLOCKED', 'This QR code was already used. Ask them to show a fresh one.')
    throw error
  }
  const athlete = await db.athlete.findFirst({ where: { id: result.athleteId }, select: { homeBranchId: true } })
  if (!athlete) throw new ApiError(422, 'CHECKIN_BLOCKED', 'Member not found')
  const branchId = input.branchId ?? staff?.bid ?? athlete.homeBranchId
  const summary = await recordCheckIn(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: config.rawSettings }, {
    athleteId: result.athleteId,
    branchId,
    method: 'QR_ROTATING',
    recordedById: staff?.sub ?? null,
    crossBranchFeature: config.features.includes('cross_branch_access'),
  })
  if (summary.status === 'checked_in') await afterCheckIn(db, { id: gym.id, slug: gym.slug }, summary.athlete.id)
  return ok(summary)
})
