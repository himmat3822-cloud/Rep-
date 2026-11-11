import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { memberSchema } from '@/lib/validation/owner'
import { updateMember } from '@/lib/owner/members'

// PATCH /api/gym/members/{id}
export const PATCH = gymRoute({ permission: 'members.write', feature: 'member_records', schema: memberSchema }, async ({ db, params, input }) => {
  const exists = await db.athlete.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!exists) throw errors.notFound('Member')
  const athlete = await updateMember(db, params.id, input)
  return ok({ id: athlete.id })
})
