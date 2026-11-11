import { publicRoute, ok } from '@/lib/api/guard'
import { signupVerifySchema } from '@/lib/validation/owner'
import { checkOtp } from '@/lib/auth/otp'
import { issueSignupTicket } from '@/lib/auth/signup-ticket'

// POST /api/signup/verify { phone, code } -> { ticket } valid for 30 minutes
export const POST = publicRoute({ schema: signupVerifySchema }, async ({ input, meta }) => {
  await checkOtp({ scope: 'SIGNUP', phone: input.phone, gymId: null, code: input.code, ip: meta.ip ?? null, consume: true })
  return ok({ ticket: await issueSignupTicket(input.phone) })
})
