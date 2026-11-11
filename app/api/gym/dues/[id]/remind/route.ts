import { gymRoute, ok } from '@/lib/api/guard'
import { remindDueNow } from '@/lib/messaging/actions'
import { audit } from '@/lib/audit'

// POST /api/gym/dues/{id}/remind - send a WhatsApp reminder now (max once a day per due)
export const POST = gymRoute({ permission: 'dues.manage', feature: 'dues_reminders', write: true }, async ({ gym, params, staff, meta }) => {
  const result = await remindDueNow({ id: gym.id, name: gym.name }, params.id)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'due.remind', entity: 'Due', entityId: params.id, meta: { template: result.template }, ip: meta.ip })
  return ok(result)
})
