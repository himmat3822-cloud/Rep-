import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { freezeSchema } from '@/lib/validation/owner'
import { freezeMembership } from '@/lib/owner/money'
import { actorFrom } from '@/lib/owner/actor'

// POST /api/gym/members/{id}/freeze - pause the plan; expiry shifts by the days
export const POST = gymRoute({ permission: 'freeze.approve', schema: freezeSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const membership = await db.membership.findFirst({ where: { id: input.membershipId, athleteId: params.id }, select: { id: true } })
  if (!membership) throw errors.notFound('Membership')
  const updated = await freezeMembership(db, gym.id, input, actorFrom(staff, meta))
  return ok({ endsAt: updated.endsAt, frozenFrom: updated.frozenFrom, frozenUntil: updated.frozenUntil })
})
