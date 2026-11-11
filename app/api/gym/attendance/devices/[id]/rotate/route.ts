import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { newDeviceKey } from '@/lib/attendance/devices'
import { audit } from '@/lib/audit'

// POST /api/gym/attendance/devices/{id}/rotate - new API key, old one stops working.
export const POST = gymRoute({ permission: 'settings.manage' }, async ({ db, gym, params, staff, meta }) => {
  const device = await db.attendanceDevice.findFirst({ where: { id: params.id } })
  if (!device) throw errors.notFound('Device')
  if (device.kind !== 'API') throw new ApiError(422, 'VALIDATION_ERROR', 'ADMS devices use their serial number, not a key')
  const key = newDeviceKey()
  await db.attendanceDevice.update({ where: { id: device.id }, data: { keyPrefix: key.prefix, keyHash: key.hash } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, action: 'device.rotate_key', entity: 'AttendanceDevice', entityId: device.id, ip: meta.ip })
  return ok({ apiKey: key.raw })
})
