import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { planChangeSchema } from '@/lib/validation/owner'
import { getGymLimits } from '@/lib/owner/limits'
import { audit } from '@/lib/audit'

// POST /api/gym/billing/plan { planId, cycle } - upgrade / downgrade.
// The new price applies from the next payment. A downgrade is refused if the
// gym is above the new plan's limits.
export const POST = gymRoute({ permission: 'billing.manage', schema: planChangeSchema, allowWhenSuspended: true }, async ({ db, gym, input, staff, meta }) => {
  const [plan, sub, limits] = await Promise.all([prisma.platformPlan.findUnique({ where: { id: input.planId } }), db.gymSubscription.findFirst(), getGymLimits(db)])
  if (!plan || plan.archived) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an available plan')
  if (!sub) throw new ApiError(404, 'NOT_FOUND', 'No Rep+ subscription found')
  const override = await db.gymOverride.findFirst()
  const memberLimit = plan.memberLimit === null ? null : plan.memberLimit + (override?.extraMembers ?? 0)
  if (memberLimit !== null && limits.members.used > memberLimit) throw new ApiError(422, 'VALIDATION_ERROR', `${plan.name} allows ${memberLimit} members and you have ${limits.members.used}. Archive some members first.`)
  const branchLimit = plan.branchLimit + (override?.extraBranches ?? 0)
  if (!plan.extraBranchPaise && limits.branches.used > branchLimit) throw new ApiError(422, 'VALIDATION_ERROR', `${plan.name} allows ${branchLimit} branch(es) and you have ${limits.branches.used}.`)
  const staffLimit = plan.staffLimit === null ? null : plan.staffLimit + (override?.extraStaff ?? 0)
  if (staffLimit !== null && limits.staff.used > staffLimit) throw new ApiError(422, 'VALIDATION_ERROR', `${plan.name} allows ${staffLimit} staff account(s) and you have ${limits.staff.used}. Disable some staff first.`)
  await db.gymSubscription.update({ where: { gymId: gym.id }, data: { planId: plan.id, cycle: input.cycle } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'billing.plan_change', entity: 'GymSubscription', entityId: sub.id, meta: { from: { planId: sub.planId, cycle: sub.cycle }, to: { planId: plan.id, cycle: input.cycle } }, ip: meta.ip })
  return ok({ planId: plan.id, cycle: input.cycle })
})
