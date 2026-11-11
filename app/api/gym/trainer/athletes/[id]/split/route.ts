import { gymRoute, ok } from '@/lib/api/guard'
import { trainerSplitSchema } from '@/lib/validation/trainer'
import { assignSplit, releaseSplit } from '@/lib/trainer/service'

// PUT    /api/gym/trainer/athletes/{id}/split - set the member's weekly split + diet notes
// DELETE /api/gym/trainer/athletes/{id}/split - hand the plan back to the member
export const PUT = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans', schema: trainerSplitSchema }, async ({ db, gym, staff, params, input }) => {
  const split = await assignSplit(db, { id: gym.id, slug: gym.slug }, staff!, params.id, input)
  return ok({ id: split.id })
})

export const DELETE = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans' }, async ({ db, staff, params }) => ok(await releaseSplit(db, staff!, params.id)))
