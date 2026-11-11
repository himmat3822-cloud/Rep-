import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@/lib/validation/athlete'

// POST   /api/g/{slug}/me/push { endpoint, keys } - turn on push for this phone
// DELETE /api/g/{slug}/me/push { endpoint }       - turn it off
export const POST = athleteRoute({ schema: pushSubscribeSchema }, async ({ db, gym, me, input, request }) => {
  // An endpoint belongs to one browser; if someone else used this phone before, take it over.
  await db.pushSubscription.deleteMany({ where: { endpoint: input.endpoint } })
  await db.pushSubscription.create({
    data: { gymId: gym.id, athleteId: me.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: (request.headers.get('user-agent') ?? '').slice(0, 200) },
  })
  return ok({ ok: true }, { status: 201 })
})

export const DELETE = athleteRoute({ schema: pushUnsubscribeSchema }, async ({ db, me, input }) => {
  await db.pushSubscription.deleteMany({ where: { endpoint: input.endpoint, athleteId: me.id } })
  return ok({ ok: true })
})
