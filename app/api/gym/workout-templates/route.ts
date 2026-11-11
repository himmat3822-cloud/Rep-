import { gymRoute, ok } from '@/lib/api/guard'
import { templateSchema } from '@/lib/validation/trainer'

// POST /api/gym/workout-templates - save a reusable plan
export const POST = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans', schema: templateSchema }, async ({ db, gym, staff, input }) => {
  const template = await db.workoutTemplate.create({ data: { gymId: gym.id, createdById: staff!.sub, name: input.name, goal: input.goal, days: { days: input.days }, dietNotes: input.dietNotes } })
  return ok({ id: template.id }, { status: 201 })
})
