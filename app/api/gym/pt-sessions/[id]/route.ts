import { gymRoute, ok } from '@/lib/api/guard'
import { deletePtSession } from '@/lib/trainer/service'

// DELETE /api/gym/pt-sessions/{id} - only while the member has not confirmed it
export const DELETE = gymRoute({ allow: ['staff'], permission: 'pt.log', feature: 'pt_tracking' }, async ({ db, staff, params }) => ok(await deletePtSession(db, staff!, params.id)))
