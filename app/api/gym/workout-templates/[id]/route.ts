import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { templateSchema } from '@/lib/validation/trainer'

// PUT / DELETE /api/gym/workout-templates/{id} - plans are shared across the gym's trainers;
// only the trainer who made one (or the owner) can change it.
async function own(db: Parameters<Parameters<typeof gymRoute>[1]>[0]['db'], staff: { sub: string; kind: string }, id: string) {
  const template = await db.workoutTemplate.findFirst({ where: { id } })
  if (!template) throw errors.notFound('Plan')
  if (staff.kind !== 'OWNER' && template.createdById !== staff.sub) throw errors.forbidden('Only the trainer who made this plan can change it')
  return template
}

export const PUT = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans', schema: templateSchema }, async ({ db, staff, params, input }) => {
  await own(db, staff!, params.id)
  await db.workoutTemplate.update({ where: { id: params.id }, data: { name: input.name, goal: input.goal, days: { days: input.days }, dietNotes: input.dietNotes } })
  return ok({ ok: true })
})

export const DELETE = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'workout_diet_plans' }, async ({ db, staff, params }) => {
  await own(db, staff!, params.id)
  await db.workoutTemplate.delete({ where: { id: params.id } })
  return ok({ ok: true })
})
