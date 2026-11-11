import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { deviceSchema } from '@/lib/validation/attendance'
import { audit } from '@/lib/audit'

// PATCH /api/gym/attendance/devices/{id} - rename, move branch, IP allow list, enable / disable
export const PATCH = gymRoute({ permission: 'settings.manage', schema: deviceSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const device = await db.attendanceDevice.findFirst({ where: { id: params.id } })
  if (!device) throw errors.notFound('Device')
  await db.attendanceDevice.update({ where: { id: device.id }, data: { name: input.name, branchId: input.branchId, vendor: input.vendor, allowedIps: input.allowedIps, active: input.active } })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, action: 'device.update', entity: 'AttendanceDevice', entityId: device.id, meta: { active: input.active }, ip: meta.ip })
  return ok({ ok: true })
})
