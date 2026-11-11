import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'

// DELETE /api/g/{slug}/me/freeze/{id} - withdraw a request that is still pending
export const DELETE = athleteRoute({}, async ({ db, me, params }) => {
  const removed = await db.freezeRequest.updateMany({ where: { id: params.id, athleteId: me.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
  if (removed.count === 0) throw errors.notFound('Request')
  return ok({ ok: true })
})
