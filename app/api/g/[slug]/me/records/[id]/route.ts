import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'

// DELETE /api/g/{slug}/me/records/{id}
export const DELETE = athleteRoute({ feature: 'progress_tracking' }, async ({ db, me, params }) => {
  await db.personalRecord.deleteMany({ where: { id: params.id, athleteId: me.id } })
  return ok({ ok: true })
})
