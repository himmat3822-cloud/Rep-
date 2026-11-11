import type { TenantDb } from '@/lib/db/tenant-core'
import { randomToken, sha256Hex, safeEqualHex } from '@/lib/crypto'
import { checkOutOpenVisit, recordCheckIn } from './checkin'

// Biometric readers and turnstiles.
//
// Two ways in:
//  1. Generic push API: device / local bridge POSTs JSON to
//     /api/devices/punches with "Authorization: Bearer kd_<prefix>_<secret>".
//  2. ZKTeco / eSSL ADMS push ("Cloud server" setting on the device) to
//     /iclock/cdata - identified by the device serial number.
// Plus a CSV import of the device's exported attendance log.
//
// Members are matched by their biometric enrolment number (Athlete.biometricId)
// or, if not set, by member code.

export interface Punch {
  userId: string
  at: Date
  direction: 'in' | 'out'
}

export interface IngestResult {
  received: number
  checkedIn: number
  checkedOut: number
  duplicates: number
  unknownUsers: string[]
  blocked: number
}

export function newDeviceKey(): { raw: string; prefix: string; hash: string } {
  const prefix = randomToken(6).replace(/[-_]/g, 'x').slice(0, 8)
  const secret = randomToken(32)
  const raw = `kd_${prefix}_${secret}`
  return { raw, prefix, hash: sha256Hex(raw) }
}

export function parseDeviceKey(header: string | null): { prefix: string; raw: string } | null {
  const raw = header?.replace(/^Bearer\s+/i, '').trim()
  const match = raw?.match(/^kd_([A-Za-z0-9]{8})_[A-Za-z0-9_-]{20,}$/)
  return match && raw ? { prefix: match[1], raw } : null
}

export function deviceKeyMatches(raw: string, hash: string | null): boolean {
  return Boolean(hash) && safeEqualHex(sha256Hex(raw), hash as string)
}

// Device clocks run on IST wall time ("2026-11-10 06:42:13").
export function parseIstDateTime(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/) ?? value.trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const isDmy = match[1].length === 2
  const [year, month, day] = isDmy ? [Number(match[3]), Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2]), Number(match[3])]
  const utc = Date.UTC(year, month - 1, day, Number(match[4]), Number(match[5]), Number(match[6] ?? 0)) - 330 * 60 * 1000
  const date = new Date(utc)
  return Number.isNaN(date.getTime()) ? null : date
}

// ZKTeco ADMS ATTLOG body: one punch per line, tab separated
//   PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify \t workcode ...
// status 0 / 3 / 4 = in, 1 / 2 / 5 = out (check-in, check-out, break, overtime).
export function parseAdmsAttlog(body: string): Punch[] {
  const punches: Punch[] = []
  for (const line of body.split(/\r?\n/)) {
    const cols = line.split('\t')
    if (cols.length < 2 || !cols[0].trim()) continue
    const at = parseIstDateTime(cols[1])
    if (!at) continue
    const status = Number(cols[2] ?? 0)
    punches.push({ userId: cols[0].trim(), at, direction: [1, 2, 5].includes(status) ? 'out' : 'in' })
  }
  return punches
}

// Attendance log exported from the device software (CSV). Finds the user
// column (id / pin / user / code / enroll) and either a date-time column or
// separate date + time columns. Every row is treated as an "in" punch unless a
// state column says out.
export function parseAttendanceCsv(text: string): { punches: Punch[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return { punches: [], skipped: 0 }
  const split = (line: string) => line.split(/,|;|\t/).map((cell) => cell.trim().replace(/^"|"$/g, ''))
  const header = split(lines[0]).map((cell) => cell.toLowerCase())
  const find = (...names: string[]) => header.findIndex((cell) => names.some((name) => cell.includes(name)))
  const userCol = find('enroll', 'pin', 'user id', 'userid', 'emp', 'member', 'code', 'id')
  const dateTimeCol = find('datetime', 'date time', 'punch time', 'time stamp', 'timestamp', 'checktime')
  const dateCol = dateTimeCol === -1 ? find('date') : -1
  const timeCol = dateTimeCol === -1 ? find('time') : -1
  const stateCol = find('state', 'status', 'direction', 'in/out', 'type')
  const punches: Punch[] = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    const cells = split(line)
    const userId = cells[userCol]
    const stamp = dateTimeCol !== -1 ? cells[dateTimeCol] : `${cells[dateCol] ?? ''} ${cells[timeCol] ?? ''}`
    const at = stamp ? parseIstDateTime(stamp) : null
    if (userCol === -1 || !userId || !at) {
      skipped += 1
      continue
    }
    const state = (cells[stateCol] ?? '').toLowerCase()
    punches.push({ userId, at, direction: /out|1|exit/.test(state) && !/in/.test(state) ? 'out' : 'in' })
  }
  return { punches, skipped }
}

export async function ingestPunches(db: TenantDb, gym: { id: string; sessionMinutes: number; settings: unknown; crossBranch: boolean }, device: { id: string; branchId: string }, punches: Punch[]): Promise<IngestResult> {
  const result: IngestResult = { received: punches.length, checkedIn: 0, checkedOut: 0, duplicates: 0, unknownUsers: [], blocked: 0 }
  if (punches.length === 0) return result
  const ids = [...new Set(punches.map((punch) => punch.userId))]
  const athletes = await db.athlete.findMany({ where: { archived: false, OR: [{ biometricId: { in: ids } }, { memberCode: { in: ids } }] }, select: { id: true, biometricId: true, memberCode: true } })
  const byUser = new Map<string, string>()
  for (const athlete of athletes) {
    if (athlete.biometricId) byUser.set(athlete.biometricId, athlete.id)
    if (!byUser.has(athlete.memberCode)) byUser.set(athlete.memberCode, athlete.id)
  }
  for (const punch of punches.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const athleteId = byUser.get(punch.userId)
    if (!athleteId) {
      if (!result.unknownUsers.includes(punch.userId)) result.unknownUsers.push(punch.userId)
      continue
    }
    if (punch.direction === 'out') {
      if (await checkOutOpenVisit(db, athleteId, punch.at)) result.checkedOut += 1
      continue
    }
    try {
      const outcome = await recordCheckIn(db, gym, {
        athleteId,
        branchId: device.branchId,
        method: 'BIOMETRIC',
        at: punch.at,
        deviceId: device.id,
        externalRef: `${device.id}:${punch.userId}:${Math.floor(punch.at.getTime() / 1000)}`,
        allowWithoutPlan: true,
        crossBranchFeature: gym.crossBranch,
      })
      if (outcome.status === 'checked_in') result.checkedIn += 1
      else result.duplicates += 1
    } catch {
      result.blocked += 1
    }
  }
  const last = punches.reduce((max, punch) => (punch.at > max ? punch.at : max), punches[0].at)
  if (device.id.startsWith('import:')) return result
  await db.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastPunchAt: last, punches: { increment: result.checkedIn } } })
  return result
}
