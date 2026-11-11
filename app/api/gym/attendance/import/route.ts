import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { ingestPunches, parseAttendanceCsv } from '@/lib/attendance/devices'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'
import { audit } from '@/lib/audit'

// POST /api/gym/attendance/import (multipart: file, branchId, deviceId?)
// Imports the attendance log exported from a biometric machine (CSV).
export const POST = gymRoute({ permission: 'attendance.checkin' }, async ({ db, gym, request, staff, meta }) => {
  const config = await loadGymConfig(db, gym.id)
  requireMethod(enabledMethods(config.settings.attendance, config.features).biometric, 'Biometric attendance')
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const branchId = String(form?.get('branchId') ?? '')
  const deviceId = String(form?.get('deviceId') ?? '')
  if (!(file instanceof Blob)) throw errors.validation('Choose the CSV file exported from the machine')
  if (file.size > 3 * 1024 * 1024) throw errors.validation('File must be under 3 MB')
  const device = deviceId ? await db.attendanceDevice.findFirst({ where: { id: deviceId } }) : null
  const branch = await db.branch.findFirst({ where: { id: device?.branchId ?? branchId, archived: false } })
  if (!branch) throw errors.validation('Pick the branch this machine is at')
  const { punches, skipped } = parseAttendanceCsv(await file.text())
  if (punches.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'No punches found. The file needs a user ID column and a date/time column.')
  const result = await ingestPunches(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: config.rawSettings, crossBranch: config.features.includes('cross_branch_access') }, device ? { id: device.id, branchId: device.branchId } : { id: `import:${branch.id}`, branchId: branch.id }, punches)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, action: 'attendance.import', entity: 'CheckIn', meta: { ...result, unknownUsers: result.unknownUsers.slice(0, 20), skippedRows: skipped }, ip: meta.ip })
  return ok({ ...result, skippedRows: skipped })
})
