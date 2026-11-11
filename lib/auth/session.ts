import 'server-only'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { isProduction } from '@/lib/env'
import { randomToken, sha256Hex } from '@/lib/crypto'
import { resolvePermissions } from './permissions'
import {
  ACCESS_TTL_SECONDS,
  signAccessToken,
  verifyAdminToken,
  verifyAthleteToken,
  verifyStaffToken,
  type AdminClaims,
  type AthleteClaims,
  type StaffClaims,
} from './jwt'
import { ApiError } from '@/lib/api/errors'

export type SessionType = 'staff' | 'athlete' | 'admin'

export const COOKIE_NAMES: Record<SessionType, { access: string; refresh: string; refreshPath: string }> = {
  staff: { access: 'k_s_at', refresh: 'k_s_rt', refreshPath: '/api/auth' },
  athlete: { access: 'k_a_at', refresh: 'k_a_rt', refreshPath: '/api/auth' },
  admin: { access: 'k_adm_at', refresh: 'k_adm_rt', refreshPath: '/api/admin/auth' },
}

const REFRESH_TTL_SECONDS: Record<SessionType, number> = {
  staff: 30 * 24 * 3600,
  athlete: 90 * 24 * 3600,
  admin: 12 * 3600,
}

// Two tabs refreshing at the same moment both present the same refresh
// token. Inside this window the loser just gets a fresh access token
// instead of tripping reuse detection.
const CONCURRENT_REFRESH_GRACE_MS = 30 * 1000

const PRINCIPAL_TYPE = { staff: 'STAFF', athlete: 'ATHLETE', admin: 'ADMIN' } as const

export interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
}

// ---------------------------------------------------------------------------
// Claims builders: always read fresh from the DB, so a refresh picks up
// permission changes, deactivation and renamed users.
// ---------------------------------------------------------------------------

export async function buildStaffClaims(userId: string, familyId: string): Promise<StaffClaims> {
  const user = await prisma.gymUser.findUnique({
    where: { id: userId },
    include: { role: true, gym: { select: { id: true, slug: true, ownerHandlesDesk: true, subscriptionStatus: true } } },
  })
  if (!user || !user.active) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This staff account is disabled. Please contact the gym owner.')
  }
  const status = user.gym.subscriptionStatus
  if ((status === 'SUSPENDED' || status === 'CANCELLED') && user.kind !== 'OWNER') {
    throw new ApiError(403, 'GYM_SUSPENDED', "Your gym's Rep+ access is suspended. Please contact the gym owner.")
  }
  return {
    typ: 'staff',
    sub: user.id,
    gid: user.gym.id,
    slug: user.gym.slug,
    kind: user.kind,
    name: user.name,
    perms: resolvePermissions(user.role.permissions, user.grants, user.denies),
    bid: user.branchId,
    desk: user.gym.ownerHandlesDesk,
    fam: familyId,
  }
}

export async function buildAthleteClaims(athleteId: string, familyId: string): Promise<AthleteClaims> {
  const athlete = await prisma.athlete.findUnique({
    where: { id: athleteId },
    include: { gym: { select: { id: true, slug: true, subscriptionStatus: true } } },
  })
  if (!athlete || athlete.archived) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account is not active at this gym.')
  }
  const status = athlete.gym.subscriptionStatus
  if (status === 'READ_ONLY' || status === 'SUSPENDED' || status === 'CANCELLED') {
    throw new ApiError(403, 'GYM_PAUSED', "Your gym's Rep+ access is paused. Please contact the gym.")
  }
  return {
    typ: 'athlete',
    sub: athlete.id,
    gid: athlete.gym.id,
    slug: athlete.gym.slug,
    name: athlete.name,
    lang: athlete.language,
    fam: familyId,
  }
}

export async function buildAdminClaims(adminUserId: string, familyId: string): Promise<AdminClaims> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } })
  if (!admin) throw new ApiError(401, 'UNAUTHENTICATED', 'Admin account not found')
  return { typ: 'admin', sub: admin.id, aid: admin.adminId, name: admin.name, fam: familyId }
}

async function buildClaims(type: SessionType, principalId: string, familyId: string) {
  if (type === 'staff') return buildStaffClaims(principalId, familyId)
  if (type === 'athlete') return buildAthleteClaims(principalId, familyId)
  return buildAdminClaims(principalId, familyId)
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

async function setAccessCookie(type: SessionType, token: string) {
  const jar = await cookies()
  jar.set(COOKIE_NAMES[type].access, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  })
}

async function setRefreshCookie(type: SessionType, token: string) {
  const jar = await cookies()
  jar.set(COOKIE_NAMES[type].refresh, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: COOKIE_NAMES[type].refreshPath,
    maxAge: REFRESH_TTL_SECONDS[type],
  })
}

export async function clearSessionCookies(type: SessionType) {
  const jar = await cookies()
  jar.set(COOKIE_NAMES[type].access, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: 0 })
  jar.set(COOKIE_NAMES[type].refresh, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: COOKIE_NAMES[type].refreshPath, maxAge: 0 })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function storeRefreshToken(type: SessionType, principalId: string, gymId: string | null, familyId: string, meta: RequestMeta): Promise<string> {
  const raw = randomToken(48)
  await prisma.refreshToken.create({
    data: {
      familyId,
      tokenHash: sha256Hex(raw),
      principalType: PRINCIPAL_TYPE[type],
      principalId,
      gymId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS[type] * 1000),
    },
  })
  return raw
}

export async function startSession(type: SessionType, principalId: string, meta: RequestMeta) {
  const familyId = randomToken(16)
  const claims = await buildClaims(type, principalId, familyId)
  const gymId = claims.typ === 'admin' ? null : claims.gid
  const access = await signAccessToken(claims)
  const refresh = await storeRefreshToken(type, principalId, gymId, familyId, meta)
  await setAccessCookie(type, access)
  await setRefreshCookie(type, refresh)
  return claims
}

export type RotateResult = { ok: true; claims: StaffClaims | AthleteClaims | AdminClaims } | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'reused' | 'disabled' }

export async function rotateSession(type: SessionType, meta: RequestMeta): Promise<RotateResult> {
  const jar = await cookies()
  const raw = jar.get(COOKIE_NAMES[type].refresh)?.value
  if (!raw) return { ok: false, reason: 'missing' }

  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(raw) } })
  if (!record || record.principalType !== PRINCIPAL_TYPE[type] || record.revokedAt) {
    await clearSessionCookies(type)
    return { ok: false, reason: 'invalid' }
  }
  if (record.expiresAt.getTime() < Date.now()) {
    await clearSessionCookies(type)
    return { ok: false, reason: 'expired' }
  }

  const claim = await prisma.refreshToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } })
  const wonRace = claim.count === 1

  if (!wonRace) {
    const usedAt = record.usedAt?.getTime() ?? Date.now()
    if (Date.now() - usedAt > CONCURRENT_REFRESH_GRACE_MS) {
      // A rotated token came back: assume theft and kill the whole family.
      await revokeFamily(record.familyId)
      await clearSessionCookies(type)
      return { ok: false, reason: 'reused' }
    }
  }

  try {
    const claims = await buildClaims(type, record.principalId, record.familyId)
    await setAccessCookie(type, await signAccessToken(claims))
    if (wonRace) {
      const next = await storeRefreshToken(type, record.principalId, record.gymId, record.familyId, meta)
      await setRefreshCookie(type, next)
    }
    return { ok: true, claims }
  } catch (error) {
    await revokeFamily(record.familyId)
    await clearSessionCookies(type)
    if (error instanceof ApiError) return { ok: false, reason: 'disabled' }
    throw error
  }
}

export async function endSession(type: SessionType) {
  const jar = await cookies()
  const raw = jar.get(COOKIE_NAMES[type].refresh)?.value
  if (raw) {
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(raw) } })
    if (record) await revokeFamily(record.familyId)
  }
  await clearSessionCookies(type)
}

export async function revokeFamily(familyId: string) {
  await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } })
}

export async function revokeAllForPrincipal(type: SessionType, principalId: string) {
  await prisma.refreshToken.updateMany({ where: { principalType: PRINCIPAL_TYPE[type], principalId, revokedAt: null }, data: { revokedAt: new Date() } })
}

// Used by admin revoke: every staff and athlete session of the gym dies.
export async function revokeAllForGym(gymId: string) {
  await prisma.refreshToken.updateMany({ where: { gymId, revokedAt: null }, data: { revokedAt: new Date() } })
}

// ---------------------------------------------------------------------------
// Readers for server components and route handlers
// ---------------------------------------------------------------------------

export async function readStaffSession(): Promise<StaffClaims | null> {
  const jar = await cookies()
  const result = await verifyStaffToken(jar.get(COOKIE_NAMES.staff.access)?.value)
  return result.ok ? result.claims : null
}

export async function readAthleteSession(): Promise<AthleteClaims | null> {
  const jar = await cookies()
  const result = await verifyAthleteToken(jar.get(COOKIE_NAMES.athlete.access)?.value)
  return result.ok ? result.claims : null
}

export async function readAdminSession(): Promise<AdminClaims | null> {
  const jar = await cookies()
  const result = await verifyAdminToken(jar.get(COOKIE_NAMES.admin.access)?.value)
  return result.ok ? result.claims : null
}

export function homePathFor(claims: StaffClaims | AthleteClaims | AdminClaims): string {
  if (claims.typ === 'admin') return '/admin'
  if (claims.typ === 'athlete') return `/g/${claims.slug}`
  if (claims.kind === 'OWNER') return '/owner'
  if (claims.kind === 'TRAINER') return '/trainer'
  return '/desk'
}

export function requestMeta(request: Request): RequestMeta {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ip: forwarded ? forwarded.split(',')[0]?.trim() : request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  }
}
