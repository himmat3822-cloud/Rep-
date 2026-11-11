import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { privacySchema } from '@/lib/validation/athlete'

// PATCH /api/g/{slug}/me/privacy - what the trainer sees, leaderboard visibility
export const PATCH = athleteRoute({ schema: privacySchema }, async ({ db, me, input }) => {
  await db.athlete.update({ where: { id: me.id }, data: input })
  return ok({ ok: true })
})
