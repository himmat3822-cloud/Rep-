import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { gymStatusSchema } from '@/lib/validation/admin'
import { adminBillingAction, type AdminBillingAction } from '@/lib/platform/billing-service'

// POST /api/admin/gyms/{id}/status
// { action: suspend | restore | cancel | extend_trial (days) | free_months (months), reason }
export const POST = adminRoute({ schema: gymStatusSchema }, async ({ params, input, admin, meta }) => {
  const exists = await prisma.gymSubscription.findUnique({ where: { gymId: params.id }, select: { id: true } })
  if (!exists) throw errors.notFound('Gym')
  const action: AdminBillingAction =
    input.action === 'extend_trial' ? { kind: 'extend_trial', days: input.days } : input.action === 'free_months' ? { kind: 'free_months', months: input.months } : { kind: input.action }
  const result = await adminBillingAction(prisma, params.id, action, { adminUserId: admin.sub, reason: input.reason, ip: meta.ip })
  return ok(result)
})
