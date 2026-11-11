import { gymRoute, ok } from '@/lib/api/guard'
import { deleteChallenge } from '@/lib/owner/engagement'

// DELETE /api/gym/challenges/{id} - remove a challenge (and its progress)
export const DELETE = gymRoute({ permission: 'challenges.manage', feature: 'challenges' }, async ({ db, params }) => ok(await deleteChallenge(db, params.id)))
