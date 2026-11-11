import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentQrStep, dailyQrKey, distanceMeters, entranceSignature, insideGeofence, istDateOfStep, makeQrToken, verifyEntranceSignature, verifyQrToken } from '@/lib/attendance/qr'
import { computeQrToken } from '@/lib/attendance/qr-client'
import { parseAdmsAttlog, parseAttendanceCsv, parseIstDateTime, newDeviceKey, parseDeviceKey, deviceKeyMatches } from '@/lib/attendance/devices'
import { enabledMethods } from '@/lib/attendance/methods'
import { openHoursFor } from '@/lib/attendance/jobs'
import { scopeToGym } from '@/lib/db/tenant-core'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb } from './helpers'

const NOW = Date.parse('2026-11-10T04:30:00Z') // 10:00 IST

describe('rotating member QR', () => {
  it('verifies a fresh token and rejects expired, tampered and other-gym tokens', () => {
    const token = makeQrToken('gymA', 'athlete1', NOW)
    expect(verifyQrToken(token, 'gymA', NOW)).toMatchObject({ ok: true, athleteId: 'athlete1' })
    expect(verifyQrToken(token, 'gymA', NOW + 59_000).ok).toBe(true)
    expect(verifyQrToken(token, 'gymA', NOW + 120_000)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyQrToken(token, 'gymB', NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyQrToken(token.replace('athlete1', 'athlete2'), 'gymA', NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyQrToken('hello', 'gymA', NOW)).toEqual({ ok: false, reason: 'format' })
  })

  it('the phone (WebCrypto) computes exactly the same code as the server', async () => {
    const step = currentQrStep(NOW)
    const key = dailyQrKey('gymA', 'athlete1', istDateOfStep(step)).toString('base64url')
    const client = await computeQrToken(key, 'athlete1', NOW)
    expect(client.token).toBe(makeQrToken('gymA', 'athlete1', NOW))
    expect(client.secondsLeft).toBeGreaterThan(0)
  })

  it('daily keys roll over at IST midnight', () => {
    expect(istDateOfStep(currentQrStep(Date.parse('2026-11-10T18:29:00Z')))).toBe('2026-11-10')
    expect(istDateOfStep(currentQrStep(Date.parse('2026-11-10T18:31:00Z')))).toBe('2026-11-11')
  })
})

describe('entrance QR and geofence', () => {
  it('signs entrance links per branch and secret', () => {
    const sig = entranceSignature('branch1', 'secret1')
    expect(verifyEntranceSignature('branch1', 'secret1', sig)).toBe(true)
    expect(verifyEntranceSignature('branch2', 'secret1', sig)).toBe(false)
    expect(verifyEntranceSignature('branch1', 'rotated', sig)).toBe(false)
    expect(verifyEntranceSignature('branch1', 'secret1', null)).toBe(false)
  })

  it('measures distance and allows GPS slack up to 100 m', () => {
    const gym = { latitude: 30.7046, longitude: 76.7179, geofenceMeters: 150 }
    expect(distanceMeters(30.7046, 76.7179, 30.7046, 76.7179)).toBe(0)
    expect(insideGeofence(gym, { lat: 30.7055, lng: 76.718 }).inside).toBe(true) // ~100 m
    expect(insideGeofence(gym, { lat: 30.7070, lng: 76.7179 }).inside).toBe(false) // ~267 m
    expect(insideGeofence(gym, { lat: 30.7066, lng: 76.7179, accuracy: 150 }).inside).toBe(true) // ~222 m, 150 + 100 slack
    expect(insideGeofence(gym, { lat: 30.72, lng: 76.7179, accuracy: 5000 }).inside).toBe(false)
  })
})

describe('owner-selected methods', () => {
  const base = { deskQr: true, selfCheckin: true, biometric: true, manual: true, selfRequireEntranceQr: true, selfRequireLocation: true, manualAllowWithoutPlan: true }
  it('a method works only if switched on AND included in the plan', () => {
    expect(enabledMethods(base, ['qr_attendance'])).toMatchObject({ deskQr: true, selfCheckin: true, biometric: false, manual: true })
    expect(enabledMethods(base, ['biometric_integration'])).toMatchObject({ deskQr: false, selfCheckin: false, biometric: true })
    expect(enabledMethods({ ...base, deskQr: false, manual: false }, ['qr_attendance'])).toMatchObject({ deskQr: false, manual: false, selfCheckin: true })
  })
})

describe('biometric parsers', () => {
  it('parses IST timestamps in common device formats', () => {
    expect(parseIstDateTime('2026-11-10 06:42:13')?.toISOString()).toBe('2026-11-10T01:12:13.000Z')
    expect(parseIstDateTime('10/11/2026 18:05')?.toISOString()).toBe('2026-11-10T12:35:00.000Z')
    expect(parseIstDateTime('garbage')).toBeNull()
  })

  it('parses ZKTeco ADMS ATTLOG lines with in / out states', () => {
    const punches = parseAdmsAttlog('105\t2026-11-10 06:42:13\t0\t1\t0\n105\t2026-11-10 08:01:00\t1\t1\t0\n\nbad line')
    expect(punches).toHaveLength(2)
    expect(punches[0]).toMatchObject({ userId: '105', direction: 'in' })
    expect(punches[1].direction).toBe('out')
  })

  it('parses exported CSV logs with combined or split date/time columns', () => {
    const a = parseAttendanceCsv('Enroll No,Name,DateTime,State\n101,Simran,2026-11-10 06:40:00,Check In\n102,Aman,2026-11-10 19:10:00,Check Out\n,,,\n')
    expect(a.punches).toHaveLength(2)
    expect(a.punches[1].direction).toBe('out')
    expect(a.skipped).toBe(1)
    const b = parseAttendanceCsv('User ID;Date;Time\n7;10-11-2026;07:15\n')
    expect(b.punches[0]).toMatchObject({ userId: '7' })
    expect(b.punches[0].at.toISOString()).toBe('2026-11-10T01:45:00.000Z')
  })

  it('device keys are shown once and stored hashed', () => {
    const key = newDeviceKey()
    const parsed = parseDeviceKey(`Bearer ${key.raw}`)
    expect(parsed?.prefix).toBe(key.prefix)
    expect(deviceKeyMatches(key.raw, key.hash)).toBe(true)
    expect(deviceKeyMatches(`${key.raw}x`, key.hash)).toBe(false)
    expect(parseDeviceKey('Bearer nope')).toBeNull()
  })

  it('reads opening hours for slot generation', () => {
    const hours = { mon: ['06:00', '09:00'], sun: null }
    expect(openHoursFor(hours, 1)).toEqual([6, 7, 8])
    expect(openHoursFor(hours, 0)).toEqual([])
    expect(openHoursFor({}, 3)).toHaveLength(16)
  })
})

describe('recording check-ins (DB)', () => {
  const db = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let planId = ''
  const gymInfo = () => ({ id: G.gym.id, sessionMinutes: 75, settings: {} })

  beforeAll(async () => {
    G = await makeGym(db, 'Attend')
    const plan = await db.membershipPlan.create({ data: { gymId: G.gym.id, name: 'Monthly', durationDays: 30, pricePaise: 150000 } })
    planId = plan.id
    await db.athlete.update({ where: { id: G.athlete.id }, data: { biometricId: '501', restDays: [] } })
  })

  afterAll(async () => {
    await purgeGymData(db, G.gym.id)
  })

  it('blocks a member with no running plan unless the method allows it', async () => {
    const { recordCheckIn } = await import('@/lib/attendance/checkin')
    const tenant = scopeToGym(db, G.gym.id)
    await expect(recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: G.branch.id, method: 'QR_ROTATING' })).rejects.toMatchObject({ code: 'CHECKIN_BLOCKED' })
    const manual = await recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: G.branch.id, method: 'MANUAL', allowWithoutPlan: true })
    expect(manual.status).toBe('checked_in')
    expect(manual.warnings[0]).toMatch(/No running plan/)
    await tenant.checkIn.deleteMany({ where: { athleteId: G.athlete.id } })
  })

  it('checks in once, returns "already inside" on a second scan, and updates the streak', async () => {
    const { recordCheckIn } = await import('@/lib/attendance/checkin')
    const tenant = scopeToGym(db, G.gym.id)
    const today = new Date(Date.UTC(new Date(Date.now() + 330 * 60000).getUTCFullYear(), new Date(Date.now() + 330 * 60000).getUTCMonth(), new Date(Date.now() + 330 * 60000).getUTCDate()))
    await tenant.membership.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, planId, startsAt: new Date(today.getTime() - 5 * 86400000), endsAt: new Date(today.getTime() + 25 * 86400000), pricePaise: 150000 } })
    // Visits on the previous two days build a streak.
    for (const daysAgo of [2, 1]) {
      await recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: G.branch.id, method: 'REGISTER', at: new Date(Date.now() - daysAgo * 86400000), allowWithoutPlan: true })
    }
    const first = await recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: G.branch.id, method: 'QR_ROTATING' })
    expect(first.status).toBe('checked_in')
    expect(first.athlete.streakDays).toBe(3)
    const again = await recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: G.branch.id, method: 'QR_ROTATING' })
    expect(again.status).toBe('already_inside')
    expect(again.checkInId).toBe(first.checkInId)
    const athlete = await tenant.athlete.findFirstOrThrow({ where: { id: G.athlete.id } })
    expect(athlete.status).toBe('NEW')
    expect(athlete.lastVisitAt).not.toBeNull()
  })

  it('rejects another branch when the plan is home-branch only', async () => {
    const { recordCheckIn } = await import('@/lib/attendance/checkin')
    const tenant = scopeToGym(db, G.gym.id)
    const other = await db.branch.create({ data: { gymId: G.gym.id, name: 'Second', entranceQrSecret: 'x2' } })
    await expect(recordCheckIn(tenant, gymInfo(), { athleteId: G.athlete.id, branchId: other.id, method: 'QR_ENTRANCE' })).rejects.toThrow(/home branch/)
  })

  it('ingests biometric punches once, matches by biometric ID and handles OUT punches', async () => {
    const { ingestPunches } = await import('@/lib/attendance/devices')
    const tenant = scopeToGym(db, G.gym.id)
    const device = await db.attendanceDevice.create({ data: { gymId: G.gym.id, branchId: G.branch.id, name: 'Door', kind: 'ADMS', serialNumber: `TST${Date.now()}` } })
    await tenant.checkIn.deleteMany({ where: { athleteId: G.athlete.id, checkedInAt: { gte: new Date(Date.now() - 3 * 3600000) } } })
    const inAt = new Date(Date.now() - 60 * 60000)
    const punches = [
      { userId: '501', at: inAt, direction: 'in' as const },
      { userId: '999', at: inAt, direction: 'in' as const },
      { userId: '501', at: new Date(Date.now() - 5 * 60000), direction: 'out' as const },
    ]
    const gym = { id: G.gym.id, sessionMinutes: 75, settings: {}, crossBranch: false }
    const first = await ingestPunches(tenant, gym, device, punches)
    expect(first).toMatchObject({ received: 3, checkedIn: 1, checkedOut: 1, unknownUsers: ['999'] })
    const second = await ingestPunches(tenant, gym, device, punches.slice(0, 1))
    expect(second.duplicates).toBe(1)
    const visit = await tenant.checkIn.findFirstOrThrow({ where: { deviceId: device.id } })
    expect(visit.method).toBe('BIOMETRIC')
    expect(visit.checkedOutAt).not.toBeNull()
    expect((await tenant.attendanceDevice.findFirstOrThrow({ where: { id: device.id } })).lastSeenAt).not.toBeNull()
  })

  it('nightly job auto-checks-out stale visits, expires plans and creates slots', async () => {
    const { runAttendanceJobsForGym } = await import('@/lib/attendance/jobs')
    const tenant = scopeToGym(db, G.gym.id)
    const stale = await tenant.checkIn.create({ data: { gymId: G.gym.id, branchId: G.branch.id, athleteId: G.athlete.id, method: 'MANUAL', checkedInAt: new Date(Date.now() - 5 * 3600000) } })
    const old = await tenant.membership.create({ data: { gymId: G.gym.id, athleteId: G.athlete.id, planId, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-02-01'), pricePaise: 1, status: 'ACTIVE' } })
    const summary = await runAttendanceJobsForGym(db, G.gym.id)
    expect(summary.autoCheckouts).toBeGreaterThanOrEqual(1)
    expect(summary.expired).toBeGreaterThanOrEqual(1)
    expect(summary.slotsCreated).toBeGreaterThan(0)
    const closed = await tenant.checkIn.findFirstOrThrow({ where: { id: stale.id } })
    expect(closed.autoCheckout).toBe(true)
    expect(closed.checkedOutAt!.getTime() - closed.checkedInAt.getTime()).toBe(75 * 60000)
    expect((await tenant.membership.findFirstOrThrow({ where: { id: old.id } })).status).toBe('EXPIRED')
    const again = await runAttendanceJobsForGym(db, G.gym.id)
    expect(again.slotsCreated).toBe(0)
  })
})
