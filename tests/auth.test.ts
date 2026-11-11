import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { base32Encode, totpAt, verifyTotp } from '@/lib/auth/totp'
import { toE164 } from '@/lib/phone'
import { hasPermission, resolvePermissions, SYSTEM_ROLES } from '@/lib/auth/permissions'
import { resolveFeatures, SOLO_FEATURES } from '@/lib/features'
import { signAccessToken, verifyAdminToken, verifyStaffToken, verifyAthleteToken } from '@/lib/auth/jwt'
import { decrypt, encrypt } from '@/lib/crypto'
import { hitRateLimit } from '@/lib/rate-limit'
import { enforceSubscription } from '@/lib/api/guard'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

// In-memory stand-in for next/headers cookies() so session code runs in tests.
const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
}))

const db = testDb()

describe('TOTP (RFC 6238)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))

  it('matches the RFC test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082')
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804')
  })

  it('accepts one step of clock drift and rejects garbage', () => {
    const now = 1111111109 * 1000
    expect(verifyTotp(secret, '081804', now)).toBe(Math.floor(1111111109 / 30))
    expect(verifyTotp(secret, '081804', now + 30_000)).not.toBeNull()
    expect(verifyTotp(secret, '081804', now + 120_000)).toBeNull()
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull()
  })
})

describe('phone normalisation', () => {
  it('converts Indian numbers to E.164', () => {
    expect(toE164('98765 43210')).toBe('+919876543210')
    expect(toE164('+91 98765-43210')).toBe('+919876543210')
    expect(toE164('09876543210')).toBe('+919876543210')
    expect(toE164('919876543210')).toBe('+919876543210')
    expect(toE164('12345')).toBeNull()
    expect(toE164('5876543210')).toBeNull()
  })
})

describe('permissions and features', () => {
  it('resolves role + grants - denies and ignores unknown keys', () => {
    const perms = resolvePermissions(SYSTEM_ROLES.TRAINER.permissions, ['payments.collect', 'root.everything'], ['progress.read'])
    expect(perms).toContain('payments.collect')
    expect(perms).not.toContain('progress.read')
    expect(perms).not.toContain('root.everything' as never)
    expect(hasPermission(perms, 'pt.log')).toBe(true)
    expect(hasPermission(perms, ['pt.log', 'staff.manage'])).toBe(false)
  })

  it('front desk cannot manage staff or settings', () => {
    const desk = resolvePermissions(SYSTEM_ROLES.DESK.permissions)
    expect(hasPermission(desk, 'staff.manage')).toBe(false)
    expect(hasPermission(desk, 'settings.manage')).toBe(false)
    expect(hasPermission(desk, 'attendance.checkin')).toBe(true)
  })

  it('resolves plan features with per-gym overrides', () => {
    const features = resolveFeatures(SOLO_FEATURES, ['leads_crm', 'not_a_feature'], ['slot_booking'])
    expect(features).toContain('leads_crm')
    expect(features).not.toContain('slot_booking')
    expect(features).not.toContain('not_a_feature' as never)
  })
})

describe('JWT audiences', () => {
  it('staff, athlete and admin tokens cannot be swapped', async () => {
    const staff = await signAccessToken({ typ: 'staff', sub: 'u1', gid: 'g1', slug: 'forge', kind: 'OWNER', name: 'G', perms: [], bid: null, desk: true, fam: 'f' })
    const admin = await signAccessToken({ typ: 'admin', sub: 'a1', aid: 'boss', name: 'Boss', fam: 'f' })
    expect((await verifyStaffToken(staff)).ok).toBe(true)
    expect((await verifyAthleteToken(staff)).ok).toBe(false)
    expect((await verifyAdminToken(staff)).ok).toBe(false)
    expect((await verifyStaffToken(admin)).ok).toBe(false)
    expect((await verifyAdminToken(admin)).ok).toBe(true)
    expect((await verifyStaffToken(`${staff}x`)).ok).toBe(false)
  })
})

describe('field encryption', () => {
  it('round-trips and produces different ciphertext each time', () => {
    const a = encrypt('JBSWY3DPEHPK3PXP')
    const b = encrypt('JBSWY3DPEHPK3PXP')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('JBSWY3DPEHPK3PXP')
    // Flip one byte of the ciphertext itself (editing the last base64 chars
    // can leave the decoded bytes unchanged, which made this test flaky).
    const [v, iv, tag, data] = a.split('.')
    const bytes = Buffer.from(data, 'base64url')
    bytes[0] ^= 0x01
    expect(() => decrypt([v, iv, tag, bytes.toString('base64url')].join('.'))).toThrow()
    expect(() => decrypt(`${v}.${iv}.${Buffer.alloc(16).toString('base64url')}.${data}`)).toThrow()
  })
})

describe('subscription gate', () => {
  it('applies the billing state machine to staff and athletes', () => {
    expect(() => enforceSubscription('PAST_DUE', 'staff', true, false)).not.toThrow()
    expect(() => enforceSubscription('READ_ONLY', 'staff', false, false)).not.toThrow()
    expect(() => enforceSubscription('READ_ONLY', 'staff', true, false)).toThrow(/read-only/)
    expect(() => enforceSubscription('READ_ONLY', 'athlete', false, false)).toThrow(/paused/)
    expect(() => enforceSubscription('SUSPENDED', 'staff', false, false)).toThrow(/suspended/)
    expect(() => enforceSubscription('SUSPENDED', 'staff', true, true)).not.toThrow()
  })
})

describe('rate limiter (Postgres)', () => {
  it('blocks after the limit within one window', async () => {
    const key = uniq('rl')
    const now = new Date()
    const results = []
    for (let i = 0; i < 4; i += 1) results.push(await hitRateLimit(db, key, 3, 60, now))
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false])
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('OTP + sessions (DB)', () => {
  let gym: Awaited<ReturnType<typeof makeGym>>

  beforeAll(async () => {
    gym = await makeGym(db, 'Otp')
  })

  afterAll(async () => {
    await purgeGymData(db, gym.gym.id)
  })

  it('issues a hashed OTP, rejects wrong codes and locks after 5 attempts', async () => {
    const { issueOtp, checkOtp, hashOtp } = await import('@/lib/auth/otp')
    const phone = gym.athlete.phone
    await issueOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, language: 'EN', ip: uniq('ip'), deliver: true })
    const row = await db.otpCode.findFirstOrThrow({ where: { phone, gymId: gym.gym.id }, orderBy: { createdAt: 'desc' } })
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000)

    // Find the real code by brute force over the hash (test only).
    let real = ''
    for (let i = 0; i < 1_000_000 && !real; i += 1) {
      const candidate = String(i).padStart(6, '0')
      if (hashOtp('ATHLETE', phone, gym.gym.id, candidate) === row.codeHash) real = candidate
    }
    expect(real).toHaveLength(6)
    const wrong = real === '000000' ? '111111' : '000000'
    await expect(checkOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, code: wrong, ip: uniq('ip'), consume: true })).rejects.toMatchObject({ code: 'INVALID_OTP' })
    await checkOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, code: real, ip: uniq('ip'), consume: true })
    await expect(checkOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, code: real, ip: uniq('ip'), consume: true })).rejects.toMatchObject({ code: 'INVALID_OTP' })

    await issueOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, language: 'EN', ip: uniq('ip'), deliver: true })
    for (let i = 0; i < 5; i += 1) {
      await expect(checkOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, code: wrong, ip: uniq('ip'), consume: true })).rejects.toMatchObject({ code: 'INVALID_OTP' })
    }
    await expect(checkOtp({ scope: 'ATHLETE', phone, gymId: gym.gym.id, code: real, ip: uniq('ip'), consume: true })).rejects.toMatchObject({ code: 'OTP_LOCKED' })
  }, 60_000)

  it('rate-limits OTP requests per phone', async () => {
    const { issueOtp } = await import('@/lib/auth/otp')
    const phone = `+9198${String(Date.now()).slice(-8)}`
    for (let i = 0; i < 3; i += 1) await issueOtp({ scope: 'STAFF', phone, gymId: null, language: 'EN', ip: uniq('ip'), deliver: false })
    await expect(issueOtp({ scope: 'STAFF', phone, gymId: null, language: 'EN', ip: uniq('ip'), deliver: false })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('rotates refresh tokens and kills the family on reuse', async () => {
    const { startSession, rotateSession, COOKIE_NAMES } = await import('@/lib/auth/session')
    jar.clear()
    await startSession('staff', gym.owner.id, { ip: '1.1.1.1' })
    const first = jar.get(COOKIE_NAMES.staff.refresh) as string
    expect(first).toBeTruthy()

    const rotated = await rotateSession('staff', {})
    expect(rotated.ok).toBe(true)
    const second = jar.get(COOKIE_NAMES.staff.refresh) as string
    expect(second).not.toBe(first)

    // Pretend the first token was used long ago, then replay it.
    await db.refreshToken.updateMany({ where: { principalId: gym.owner.id, usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - 60_000) } })
    jar.set(COOKIE_NAMES.staff.refresh, first)
    const replay = await rotateSession('staff', {})
    expect(replay).toEqual({ ok: false, reason: 'reused' })

    jar.set(COOKIE_NAMES.staff.refresh, second)
    const afterKill = await rotateSession('staff', {})
    expect(afterKill.ok).toBe(false)
  })

  it('refresh fails once the staff account is disabled', async () => {
    const { startSession, rotateSession } = await import('@/lib/auth/session')
    jar.clear()
    await startSession('staff', gym.owner.id, {})
    await db.gymUser.update({ where: { id: gym.owner.id }, data: { active: false } })
    const result = await rotateSession('staff', {})
    expect(result).toEqual({ ok: false, reason: 'disabled' })
    await db.gymUser.update({ where: { id: gym.owner.id }, data: { active: true } })
  })
})
