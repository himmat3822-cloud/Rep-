import { gymRoute, ok } from '@/lib/api/guard'
import { branchSchema } from '@/lib/validation/owner'
import { assertCanAdd } from '@/lib/owner/limits'
import { randomToken } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { branchData } from '@/lib/owner/branches'

// POST /api/gym/branches - add a branch (plan branch limit applies; Elite bills extra branches)
export const POST = gymRoute({ permission: 'settings.manage', schema: branchSchema }, async ({ db, gym, input, staff, meta }) => {
  await assertCanAdd(db, 'branch')
  const branch = await db.branch.create({ data: { gymId: gym.id, entranceQrSecret: randomToken(24), ...branchData(input) } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'branch.create', entity: 'Branch', entityId: branch.id, ip: meta.ip })
  return ok({ id: branch.id }, { status: 201 })
})
