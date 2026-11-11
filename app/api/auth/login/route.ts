import { publicRoute, ok } from '@/lib/api/guard'
import { passwordLoginSchema } from '@/lib/validation/auth'
import { passwordLogin } from '@/lib/auth/login'
import { homePathFor } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/session-user'
import type { LoginResponse } from '@/lib/api/types'

// POST /api/auth/login  { email, password, gymSlug? }
export const POST = publicRoute({ schema: passwordLoginSchema }, async ({ input, meta }) => {
  const claims = await passwordLogin(input.email, input.password, input.gymSlug, meta)
  const body: LoginResponse = { user: toSessionUser(claims), redirectTo: homePathFor(claims) }
  return ok(body)
})
