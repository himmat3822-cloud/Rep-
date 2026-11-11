import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { archiveSchema } from '@/lib/validation/owner'
import { assertCanAdd } from '@/lib/owner/limits'
import { audit } from '@/lib/audit'

// POST /api/gym/members/{id}/archive { archived } - archive or restore
export const POST = gymRoute({ permission: 'members.delete', schema: archiveSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const athlete = await db.athlete.findFirst({ where: { id: params.id } })
  if (!athlete) throw errors.notFound('Member')
  if (!input.archived && athlete.archived) await assertCanAdd(db, 'member')
  await db.athlete.update({ where: { id: athlete.id }, data: { archived: input.archived } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: input.archived ? 'member.archive' : 'member.restore', entity: 'Athlete', entityId: athlete.id, ip: meta.ip })
  return ok({ archived: input.archived })
})
