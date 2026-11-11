import { gymRoute, ok } from '@/lib/api/guard'
import { challengeSchema } from '@/lib/validation/growth'
import { createChallenge } from '@/lib/owner/engagement'

// POST /api/gym/challenges - "20 visits in November". Progress updates on
// every check-in; finishers get the Challenge Champ badge.
export const POST = gymRoute({ permission: 'challenges.manage', feature: 'challenges', schema: challengeSchema }, async ({ db, gym, input }) => {
  const row = await createChallenge(db, gym.id, input)
  return ok({ id: row.id }, { status: 201 })
})
