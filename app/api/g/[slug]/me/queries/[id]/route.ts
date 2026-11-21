import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { queryMessageSchema } from '@/lib/validation/queries'
import { addMemberMessage } from '@/lib/queries/service'
import { hitRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db/client'

// POST /api/g/{slug}/me/queries/{id} { body } - add a message to my query (reopens it)
export const POST = athleteRoute({ schema: queryMessageSchema }, async ({ db, gym, me, params, input }) => {
  const limit = await hitRateLimit(prisma, `query-msg:${me.id}`, 30, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  await addMemberMessage(db, gym, me, params.id, input.body)
  return ok({ id: params.id })
})
