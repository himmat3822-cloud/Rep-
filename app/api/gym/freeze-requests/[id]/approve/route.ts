import { gymRoute, ok } from '@/lib/api/guard'
import { decideFreeze } from '@/lib/athlete/payments'
import { actorFrom } from '@/lib/owner/actor'

// POST /api/gym/freeze-requests/{id}/approve - pause the plan, end date moves
export const POST = gymRoute({ permission: 'freeze.approve', write: true }, async ({ db, gym, params, staff, meta }) => ok(await decideFreeze(db, { id: gym.id, slug: gym.slug }, params.id, true, actorFrom(staff, meta))))
