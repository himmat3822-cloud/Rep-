import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { queryCreateSchema } from '@/lib/validation/queries'
import { createQuery, memberQueries } from '@/lib/queries/service'
import { hitRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db/client'

// GET  /api/g/{slug}/me/queries                 - my queries with their messages
// POST /api/g/{slug}/me/queries { topic, body } - ask my trainer something
export const GET = athleteRoute({}, async ({ db, me }) => {
  return ok({ queries: await memberQueries(db, me.id) })
})

export const POST = athleteRoute({ schema: queryCreateSchema }, async ({ db, gym, me, input }) => {
  const limit = await hitRateLimit(prisma, `query:${me.id}`, 10, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const query = await createQuery(db, gym, me, input)
  return ok({ id: query.id }, { status: 201 })
})
