import { publicRoute, ok } from '@/lib/api/guard'
import { adminLoginSchema } from '@/lib/validation/auth'
import { adminLogin } from '@/lib/auth/login'
import { toSessionUser } from '@/lib/auth/session-user'
import type { LoginResponse } from '@/lib/api/types'

// POST /api/admin/auth/login  { adminId, password, totp }
export const POST = publicRoute({ schema: adminLoginSchema }, async ({ input, meta }) => {
  const claims = await adminLogin(input.adminId, input.password, input.totp, meta)
  const body: LoginResponse = { user: toSessionUser(claims), redirectTo: '/admin' }
  return ok(body)
})
