import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { membershipPlanSchema } from '@/lib/validation/owner'
import { membershipPlanData } from '@/lib/owner/plans'
import { audit } from '@/lib/audit'

// PATCH /api/gym/plans/{id} - existing memberships keep the price they were sold at.
export const PATCH = gymRoute({ permission: 'plans.manage', feature: 'membership_plans', schema: membershipPlanSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const before = await db.membershipPlan.findFirst({ where: { id: params.id } })
  if (!before) throw errors.notFound('Plan')
  const plan = await db.membershipPlan.update({ where: { id: params.id }, data: membershipPlanData(input) })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'plan.update', entity: 'MembershipPlan', entityId: plan.id, meta: { before: { pricePaise: before.pricePaise, active: before.active }, after: { pricePaise: plan.pricePaise, active: plan.active } }, ip: meta.ip })
  return ok(plan)
})
