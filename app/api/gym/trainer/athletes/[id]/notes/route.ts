import { gymRoute, ok } from '@/lib/api/guard'
import { trainerNoteSchema } from '@/lib/validation/trainer'
import { addNote } from '@/lib/trainer/service'

// POST /api/gym/trainer/athletes/{id}/notes - a note the member sees in their app
export const POST = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'trainer_dashboard', schema: trainerNoteSchema }, async ({ db, gym, staff, params, input }) => {
  const note = await addNote(db, { id: gym.id, slug: gym.slug }, staff!, params.id, input.body)
  return ok({ id: note.id }, { status: 201 })
})
