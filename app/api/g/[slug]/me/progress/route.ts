import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { progressLogSchema } from '@/lib/validation/athlete'
import { istDateOnly } from '@/lib/time'

// POST /api/g/{slug}/me/progress - today's weight / measurements (one row per day)
export const POST = athleteRoute({ feature: 'progress_tracking', schema: progressLogSchema }, async ({ db, gym, me, input }) => {
  const loggedOn = istDateOnly()
  const existing = await db.progressLog.findFirst({ where: { athleteId: me.id, loggedOn } })
  const row = existing
    ? await db.progressLog.update({ where: { id: existing.id }, data: input })
    : await db.progressLog.create({ data: { gymId: gym.id, athleteId: me.id, loggedOn, ...input } })
  return ok({ id: row.id }, { status: existing ? 200 : 201 })
})
