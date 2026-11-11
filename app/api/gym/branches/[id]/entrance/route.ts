import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { randomToken } from '@/lib/crypto'
import { audit } from '@/lib/audit'

// POST /api/gym/branches/{id}/entrance - new entrance QR (old posters stop working).
export const POST = gymRoute({ permission: 'settings.manage' }, async ({ db, gym, params, staff, meta }) => {
  const branch = await db.branch.findFirst({ where: { id: params.id } })
  if (!branch) throw errors.notFound('Branch')
  await db.branch.update({ where: { id: branch.id }, data: { entranceQrSecret: randomToken(24) } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, action: 'branch.entrance_qr_rotate', entity: 'Branch', entityId: branch.id, ip: meta.ip })
  return ok({ ok: true })
})
