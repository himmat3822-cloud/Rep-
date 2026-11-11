import { publicRoute, ok } from '@/lib/api/guard'
import { signupOtpSchema } from '@/lib/validation/owner'
import { issueOtp } from '@/lib/auth/otp'

// POST /api/signup/otp { phone } - verify the owner's WhatsApp number first.
export const POST = publicRoute({ schema: signupOtpSchema }, async ({ input, meta }) =>
  ok(await issueOtp({ scope: 'SIGNUP', phone: input.phone, gymId: null, language: 'EN', ip: meta.ip ?? null, deliver: true })),
)
