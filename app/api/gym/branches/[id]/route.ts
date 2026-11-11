import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { branchSchema } from '@/lib/validation/owner'
import { branchData } from '@/lib/owner/branches'
import { audit } from '@/lib/audit'

// PATCH /api/gym/branches/{id}
export const PATCH = gymRoute({ permission: 'settings.manage', schema: branchSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const branch = await db.branch.findFirst({ where: { id: params.id } })
  if (!branch) throw errors.notFound('Branch')
  if (input.archived && branch.isPrimary) throw new ApiError(422, 'VALIDATION_ERROR', 'The primary branch cannot be archived')
  if (input.archived) {
    const members = await db.athlete.count({ where: { homeBranchId: branch.id, archived: false } })
    if (members > 0) throw new ApiError(422, 'VALIDATION_ERROR', `Move the ${members} member(s) of this branch first`)
  }
  await db.branch.update({ where: { id: branch.id }, data: branchData(input) })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'branch.update', entity: 'Branch', entityId: branch.id, ip: meta.ip })
  return ok({ ok: true })
})
