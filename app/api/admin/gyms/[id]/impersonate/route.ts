import { adminRoute, ok } from '@/lib/api/guard'
import { impersonateSchema } from '@/lib/validation/admin'
import { startImpersonation } from '@/lib/auth/impersonation'

// POST /api/admin/gyms/{id}/impersonate { mode: read | write, reason }
export const POST = adminRoute({ schema: impersonateSchema }, async ({ params, input, admin, meta }) => {
  const result = await startImpersonation(admin, params.id, input.mode, input.reason, meta)
  return ok({ ...result, redirectTo: '/owner' })
})
