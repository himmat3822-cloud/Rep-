import 'server-only'
import { prisma } from '@/lib/db/client'
import { hitRateLimit } from '@/lib/rate-limit'
import { ApiError, errors } from '@/lib/api/errors'
import type { GymChoice } from '@/lib/api/types'
import { decrypt } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { checkOtp, issueOtp } from './otp'
import { verifyPassword } from './password'
import { verifyTotp } from './totp'
import { startSession, type RequestMeta } from './session'

// Login flows for every role. Route handlers stay thin and call these.

async function enforce(key: string, limit: number, windowSeconds: number) {
  const result = await hitRateLimit(prisma, key, limit, windowSeconds)
  if (!result.ok) throw errors.rateLimited(result.retryAfterSeconds)
}

function gymSelection(choices: GymChoice[]): ApiError {
  return new ApiError(409, 'GYM_SELECTION_REQUIRED', 'Your number is linked to more than one gym. Pick one to continue.', { gyms: choices })
}

// ---------------------------------------------------------------------------
// Staff (owner, trainer, front desk) - WhatsApp OTP
// ---------------------------------------------------------------------------

export async function requestStaffOtp(phone: string, meta: RequestMeta) {
  const users = await prisma.gymUser.findMany({ where: { phone, active: true }, select: { language: true }, take: 1 })
  return issueOtp({
    scope: 'STAFF',
    phone,
    gymId: null,
    language: users[0]?.language ?? 'EN',
    ip: meta.ip ?? null,
    deliver: users.length > 0,
  })
}

export async function verifyStaffOtp(phone: string, code: string, gymSlug: string | undefined, meta: RequestMeta) {
  const users = await prisma.gymUser.findMany({
    where: { phone, active: true },
    include: { gym: { select: { slug: true, name: true, city: true } } },
    orderBy: { createdAt: 'asc' },
  })

  let chosen = users.length === 1 ? users[0] : undefined
  if (gymSlug) chosen = users.find((user) => user.gym.slug === gymSlug)

  if (!chosen && users.length > 1 && !gymSlug) {
    await checkOtp({ scope: 'STAFF', phone, gymId: null, code, ip: meta.ip ?? null, consume: false })
    throw gymSelection(users.map((user) => ({ slug: user.gym.slug, name: user.gym.name, city: user.gym.city })))
  }

  await checkOtp({ scope: 'STAFF', phone, gymId: null, code, ip: meta.ip ?? null, consume: true })
  if (!chosen) throw new ApiError(400, 'INVALID_OTP', 'That code is not correct or has expired. Request a new one.')

  const claims = await startSession('staff', chosen.id, meta)
  await prisma.gymUser.update({ where: { id: chosen.id }, data: { lastLoginAt: new Date() } })
  return claims
}

// ---------------------------------------------------------------------------
// Owner (or any staff with a password) - email + password
// ---------------------------------------------------------------------------

export async function passwordLogin(email: string, password: string, gymSlug: string | undefined, meta: RequestMeta) {
  await enforce(`login:ip:${meta.ip ?? 'unknown'}`, 30, 15 * 60)
  await enforce(`login:email:${email}`, 5, 15 * 60)

  const candidates = await prisma.gymUser.findMany({
    where: { email, active: true, passwordHash: { not: null } },
    include: { gym: { select: { slug: true, name: true, city: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const scoped = gymSlug ? candidates.filter((user) => user.gym.slug === gymSlug) : candidates
  const matches = []
  for (const user of scoped) {
    if (await verifyPassword(password, user.passwordHash)) matches.push(user)
  }
  if (scoped.length === 0) await verifyPassword(password, null)
  if (matches.length === 0) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
  if (matches.length > 1) throw gymSelection(matches.map((user) => ({ slug: user.gym.slug, name: user.gym.name, city: user.gym.city })))

  const user = matches[0]
  const claims = await startSession('staff', user.id, meta)
  await prisma.gymUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return claims
}

// ---------------------------------------------------------------------------
// Athletes - WhatsApp OTP inside their gym (kasrat.app/g/{slug})
// ---------------------------------------------------------------------------

async function gymBySlug(slug: string | undefined) {
  if (!slug) throw errors.validation('Gym link is missing')
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, defaultLanguage: true } })
  if (!gym) throw errors.notFound('Gym')
  return gym
}

export async function requestAthleteOtp(phone: string, gymSlug: string | undefined, meta: RequestMeta) {
  const gym = await gymBySlug(gymSlug)
  const athlete = await prisma.athlete.findFirst({ where: { gymId: gym.id, phone, archived: false }, select: { language: true } })
  return issueOtp({
    scope: 'ATHLETE',
    phone,
    gymId: gym.id,
    language: athlete?.language ?? gym.defaultLanguage,
    ip: meta.ip ?? null,
    deliver: Boolean(athlete),
  })
}

export async function verifyAthleteOtp(phone: string, code: string, gymSlug: string | undefined, meta: RequestMeta) {
  const gym = await gymBySlug(gymSlug)
  await checkOtp({ scope: 'ATHLETE', phone, gymId: gym.id, code, ip: meta.ip ?? null, consume: true })
  const athlete = await prisma.athlete.findFirst({ where: { gymId: gym.id, phone, archived: false }, select: { id: true } })
  if (!athlete) throw new ApiError(400, 'INVALID_OTP', 'That code is not correct or has expired. Request a new one.')
  const claims = await startSession('athlete', athlete.id, meta)
  await prisma.athlete.update({ where: { id: athlete.id }, data: { lastAppOpenAt: new Date() } })
  return claims
}

// ---------------------------------------------------------------------------
// Super admin - Admin ID + password + TOTP
// ---------------------------------------------------------------------------

export async function adminLogin(adminId: string, password: string, totp: string, meta: RequestMeta) {
  await enforce(`admin-login:ip:${meta.ip ?? 'unknown'}`, 10, 15 * 60)
  await enforce(`admin-login:id:${adminId}`, 5, 15 * 60)

  const admin = await prisma.adminUser.findUnique({ where: { adminId } })
  const passwordOk = await verifyPassword(password, admin?.passwordHash)
  const invalid = new ApiError(401, 'INVALID_CREDENTIALS', 'Admin ID, password or authenticator code is incorrect.')
  if (!admin || !passwordOk || !admin.totpEnabled || !admin.totpSecretEnc) {
    if (admin) await audit({ actorType: 'ADMIN', actorId: admin.id, adminUserId: admin.id, action: 'admin.login_failed', entity: 'AdminUser', entityId: admin.id, ip: meta.ip })
    throw invalid
  }

  const step = verifyTotp(decrypt(admin.totpSecretEnc), totp)
  if (step === null || (admin.lastTotpStep !== null && step <= admin.lastTotpStep)) {
    await audit({ actorType: 'ADMIN', actorId: admin.id, adminUserId: admin.id, action: 'admin.login_failed_totp', entity: 'AdminUser', entityId: admin.id, ip: meta.ip })
    throw invalid
  }

  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastTotpStep: step, lastLoginAt: new Date() } })
  const claims = await startSession('admin', admin.id, meta)
  await audit({ actorType: 'ADMIN', actorId: admin.id, adminUserId: admin.id, action: 'admin.login', entity: 'AdminUser', entityId: admin.id, ip: meta.ip })
  return claims
}
