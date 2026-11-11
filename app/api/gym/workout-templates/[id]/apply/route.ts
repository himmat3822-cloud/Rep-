import { gymRoute, ok } from '@/lib/api/guard'
import { applyTemplateSchema } from '@/lib/validation/trainer'
import { applyTemplate } from '@/lib/trainer/service'

// POST /api/gym/workout-templates/{id}/apply { athleteIds } - give this plan to members on your roster
export const POST = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans', schema: applyTemplateSchema }, async ({ db, gym, staff, params, input }) =>
  ok(await applyTemplate(db, { id: gym.id, slug: gym.slug }, staff!, params.id, input.athleteIds)),
)
