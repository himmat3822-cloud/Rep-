import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { splitSchema } from '@/lib/validation/athlete'

// PUT /api/g/{slug}/me/split - the member's own weekly split.
// A split assigned by a trainer is the trainer's to change.
export const PUT = athleteRoute({ schema: splitSchema }, async ({ db, gym, me, input }) => {
  const current = await db.workoutSplit.findFirst({ where: { athleteId: me.id, active: true }, orderBy: { updatedAt: 'desc' } })
  if (current?.createdById) throw errors.forbidden('Your trainer manages this split. Ask them for changes.')
  const days = { days: [...input.days].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)) }
  const split = current
    ? await db.workoutSplit.update({ where: { id: current.id }, data: { days } })
    : await db.workoutSplit.create({ data: { gymId: gym.id, athleteId: me.id, createdById: null, days } })
  return ok({ id: split.id })
})
