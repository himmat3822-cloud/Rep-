import { gymRoute, ok } from '@/lib/api/guard'
import { decideFreeze } from '@/lib/athlete/payments'
import { actorFrom } from '@/lib/owner/actor'
import { audit } from '@/lib/audit'

// POST /api/gym/freeze-requests/{id}/reject
export const POST = gymRoute({ permission: 'freeze.approve', write: true }, async ({ db, gym, params, staff, meta }) => {
  const result = await decideFreeze(db, { id: gym.id, slug: gym.slug }, params.id, false, actorFrom(staff, meta))
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'freeze.reject', entity: 'FreezeRequest', entityId: params.id, ip: meta.ip })
  return ok(result)
})
