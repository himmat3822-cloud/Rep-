import { z } from 'zod'
import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'

const schema = z.object({ language: z.enum(['EN', 'HI', 'PA']) })

// PATCH /api/g/{slug}/me/language  { language } - saved per athlete
export const PATCH = gymRoute({ allow: ['athlete'], schema }, async ({ athlete, db, input }) => {
  if (!athlete) throw errors.forbidden()
  const updated = await db.athlete.update({ where: { id: athlete.sub }, data: { language: input.language }, select: { language: true } })
  return ok(updated)
})
