import { publicRoute, ok } from '@/lib/api/guard'
import { otpVerifySchema } from '@/lib/validation/auth'
import { verifyAthleteOtp, verifyStaffOtp } from '@/lib/auth/login'
import { homePathFor } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/session-user'
import type { LoginResponse } from '@/lib/api/types'

// POST /api/auth/otp/verify
// { phone, code, scope, gymSlug? } -> sets httpOnly cookies
export const POST = publicRoute({ schema: otpVerifySchema }, async ({ input, meta }) => {
  const claims =
    input.scope === 'athlete'
      ? await verifyAthleteOtp(input.phone, input.code, input.gymSlug, meta)
      : await verifyStaffOtp(input.phone, input.code, input.gymSlug, meta)
  const body: LoginResponse = { user: toSessionUser(claims), redirectTo: homePathFor(claims) }
  return ok(body)
})
