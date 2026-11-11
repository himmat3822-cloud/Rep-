import { gymRoute, ok } from '@/lib/api/guard'
import { deleteNote } from '@/lib/trainer/service'

// DELETE /api/gym/trainer/notes/{id} - own notes only (owners: any)
export const DELETE = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'trainer_dashboard' }, async ({ db, staff, params }) => ok(await deleteNote(db, staff!, params.id)))
