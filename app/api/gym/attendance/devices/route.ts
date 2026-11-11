import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { deviceSchema } from '@/lib/validation/attendance'
import { newDeviceKey } from '@/lib/attendance/devices'
import { audit } from '@/lib/audit'

// GET  /api/gym/attendance/devices
// POST /api/gym/attendance/devices - register a biometric reader / turnstile.
// API devices get a secret key ONCE in the response. ADMS devices are
// matched by serial number.
export const GET = gymRoute({ permission: 'settings.manage' }, async ({ db }) =>
  ok(await db.attendanceDevice.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, kind: true, vendor: true, serialNumber: true, keyPrefix: true, branchId: true, allowedIps: true, active: true, lastSeenAt: true, lastPunchAt: true, punches: true } })),
)

export const POST = gymRoute({ permission: 'settings.manage', feature: 'biometric_integration', schema: deviceSchema }, async ({ db, gym, input, staff, meta }) => {
  const branch = await db.branch.findFirst({ where: { id: input.branchId, archived: false } })
  if (!branch) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a branch')
  if (input.kind === 'ADMS') {
    if (!input.serialNumber) throw new ApiError(422, 'VALIDATION_ERROR', 'Enter the serial number shown on the device')
    const taken = await prisma.attendanceDevice.findUnique({ where: { serialNumber: input.serialNumber } })
    if (taken) throw new ApiError(409, 'CONFLICT', 'A device with this serial number is already registered')
  }
  const key = input.kind === 'API' ? newDeviceKey() : null
  const device = await db.attendanceDevice.create({
    data: { gymId: gym.id, branchId: input.branchId, name: input.name, kind: input.kind, vendor: input.vendor, serialNumber: input.kind === 'ADMS' ? input.serialNumber : null, keyPrefix: key?.prefix ?? null, keyHash: key?.hash ?? null, allowedIps: input.allowedIps, active: input.active },
  })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, action: 'device.create', entity: 'AttendanceDevice', entityId: device.id, meta: { kind: device.kind }, ip: meta.ip })
  return ok({ id: device.id, apiKey: key?.raw ?? null }, { status: 201 })
})
