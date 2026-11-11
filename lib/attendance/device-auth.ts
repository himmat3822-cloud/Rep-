import 'server-only'
import { prisma } from '@/lib/db/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { getGymFeatures } from '@/lib/gym/features'
import { parseGymSettings } from '@/lib/gym/settings'
import { enabledMethods } from './methods'
import { ingestPunches, type IngestResult, type Punch } from './devices'

// Shared by the JSON push API and the ZKTeco ADMS endpoint. The device row
// tells us the gym, so this is the only place devices touch tenant data.

export type DeviceRow = NonNullable<Awaited<ReturnType<typeof prisma.attendanceDevice.findUnique>>>

export function clientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')
}

export async function acceptPunches(device: DeviceRow, request: Request, punches: Punch[]): Promise<{ ok: true; result: IngestResult } | { ok: false; status: number; message: string }> {
  if (!device.active) return { ok: false, status: 403, message: 'Device is disabled' }
  const ip = clientIp(request)
  if (device.allowedIps.length && (!ip || !device.allowedIps.includes(ip))) return { ok: false, status: 403, message: 'IP not allowed for this device' }
  const gym = await prisma.gym.findUnique({ where: { id: device.gymId }, select: { id: true, sessionMinutes: true, settings: true, subscriptionStatus: true } })
  if (!gym || gym.subscriptionStatus === 'SUSPENDED' || gym.subscriptionStatus === 'CANCELLED') return { ok: false, status: 403, message: 'Gym is not active on Rep+' }
  const features = await getGymFeatures(gym.id)
  if (!enabledMethods(parseGymSettings(gym.settings).attendance, features).biometric) return { ok: false, status: 403, message: 'Biometric attendance is switched off for this gym' }
  const db = scopeToGym(prisma, gym.id)
  const result = await ingestPunches(db, { id: gym.id, sessionMinutes: gym.sessionMinutes, settings: gym.settings, crossBranch: features.includes('cross_branch_access') }, { id: device.id, branchId: device.branchId }, punches)
  return { ok: true, result }
}
