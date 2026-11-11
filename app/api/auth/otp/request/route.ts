import { publicRoute, ok } from '@/lib/api/guard'
import { otpRequestSchema } from '@/lib/validation/auth'
import { requestAthleteOtp, requestStaffOtp } from '@/lib/auth/login'
import type { OtpRequestResponse } from '@/lib/api/types'

// POST /api/auth/otp/request
// { phone, scope: 'staff' | 'athlete', gymSlug? }
// Always answers the same way whether or not the number has an account.
export const POST = publicRoute({ schema: otpRequestSchema }, async ({ input, meta }) => {
  const result: OtpRequestResponse =
    input.scope === 'athlete' ? await requestAthleteOtp(input.phone, input.gymSlug, meta) : await requestStaffOtp(input.phone, meta)
  return ok(result)
})
