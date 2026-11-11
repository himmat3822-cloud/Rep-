import { gymRoute, ok } from '@/lib/api/guard'
import { membershipPlanSchema } from '@/lib/validation/owner'
import { membershipPlanData } from '@/lib/owner/plans'
import { audit } from '@/lib/audit'

// GET /api/gym/plans - membership plans this gym sells
export const GET = gymRoute({ permission: 'members.read' }, async ({ db }) => ok(await db.membershipPlan.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }] })))

// POST /api/gym/plans
export const POST = gymRoute({ permission: 'plans.manage', feature: 'membership_plans', schema: membershipPlanSchema }, async ({ db, gym, input, staff, meta }) => {
  const plan = await db.membershipPlan.create({ data: { gymId: gym.id, ...membershipPlanData(input) } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'plan.create', entity: 'MembershipPlan', entityId: plan.id, meta: { name: plan.name, pricePaise: plan.pricePaise }, ip: meta.ip })
  return ok(plan, { status: 201 })
})
