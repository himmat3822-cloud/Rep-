import { z } from 'zod'
import { adminRoute, ok } from '@/lib/api/guard'
import { readStaffSession } from '@/lib/auth/session'
import { stopImpersonation } from '@/lib/auth/impersonation'

// POST /api/admin/impersonate/stop - drops the impersonated owner session.
export const POST = adminRoute({ schema: z.object({}).passthrough() }, async ({ admin }) => {
  const staff = await readStaffSession()
  const gymId = staff?.imp ? staff.gid : null
  await stopImpersonation(admin, gymId)
  return ok({ redirectTo: gymId ? `/admin/gyms/${gymId}` : '/admin/gyms' })
})
