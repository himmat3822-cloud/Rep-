import { gymRoute, ok } from '@/lib/api/guard'
import { gymProfileSchema } from '@/lib/validation/owner'
import { audit } from '@/lib/audit'

// PATCH /api/gym/settings - gym profile (name, address, GSTIN, contact)
export const PATCH = gymRoute({ permission: 'settings.manage', schema: gymProfileSchema }, async ({ db, gym, input, staff, meta }) => {
  await db.gym.update({ where: { id: gym.id }, data: { name: input.name, city: input.city, address: input.address, gstNumber: input.gstNumber || null, phone: input.phone || null, email: input.email || null } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'settings.profile', entity: 'Gym', entityId: gym.id, ip: meta.ip })
  return ok({ ok: true })
})
