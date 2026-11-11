import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { freezeRequestSchema } from '@/lib/validation/athlete'
import { requestFreeze } from '@/lib/athlete/payments'

// POST /api/g/{slug}/me/freeze - ask the gym to pause the plan
export const POST = athleteRoute({ schema: freezeRequestSchema }, async ({ db, gym, me, input }) => {
  const request = await requestFreeze(db, gym.id, me, input)
  return ok({ id: request.id }, { status: 201 })
})
