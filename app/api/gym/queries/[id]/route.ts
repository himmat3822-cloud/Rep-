import { gymRoute, ok } from '@/lib/api/guard'
import { queryReplySchema } from '@/lib/validation/queries'
import { replyToQuery } from '@/lib/queries/service'

// POST /api/gym/queries/{id} { body, close } - trainer or owner answers a
// member query. Trainers can answer only their own members (checked inside).
export const POST = gymRoute({ permission: 'workouts.manage', schema: queryReplySchema }, async ({ db, gym, staff, params, input }) => {
  const result = await replyToQuery(db, gym, { id: staff!.sub, name: staff!.name, kind: staff!.kind }, params.id, input)
  return ok(result)
})
