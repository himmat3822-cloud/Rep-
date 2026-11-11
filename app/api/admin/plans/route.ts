import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { planSchema } from '@/lib/validation/admin'
import { planData } from '@/lib/platform/plans'

// GET /api/admin/plans - all plans incl. archived, with subscriber counts
export const GET = adminRoute({}, async () => {
  const plans = await prisma.platformPlan.findMany({ orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { subscriptions: true } } } })
  return ok(plans)
})

// POST /api/admin/plans - create
export const POST = adminRoute({ schema: planSchema }, async ({ input, admin, meta }) => {
  const taken = await prisma.platformPlan.findUnique({ where: { code: input.code } })
  if (taken) throw errors.conflict('A plan with this code already exists')
  const plan = await prisma.platformPlan.create({ data: { code: input.code, ...planData(input) } })
  await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'plan.create', entity: 'PlatformPlan', entityId: plan.id, meta: { code: plan.code, monthlyPricePaise: plan.monthlyPricePaise }, ip: meta.ip })
  return ok(plan, { status: 201 })
})
