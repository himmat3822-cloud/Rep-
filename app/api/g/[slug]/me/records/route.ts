import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { recordSchema } from '@/lib/validation/athlete'
import { istDateOnly } from '@/lib/time'
import { afterCheckIn } from '@/lib/athlete/badge-rules'

// POST /api/g/{slug}/me/records - a personal record (lift)
export const POST = athleteRoute({ feature: 'progress_tracking', schema: recordSchema }, async ({ db, gym, me, input }) => {
  const record = await db.personalRecord.create({
    data: { gymId: gym.id, athleteId: me.id, exercise: input.exercise, weightKg: input.weightKg, reps: input.reps, achievedOn: istDateOnly(input.achievedOn ?? new Date()) },
  })
  await afterCheckIn(db, { id: gym.id, slug: gym.slug }, me.id)
  return ok({ id: record.id }, { status: 201 })
})
