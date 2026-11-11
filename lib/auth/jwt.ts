import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'

// Short-lived access tokens. Gym users and athletes share JWT_SECRET,
// super admins use a separate JWT_ADMIN_SECRET so a gym token can never be
// replayed against /admin.

export const ACCESS_TTL_SECONDS = 15 * 60
export const ISSUER = 'kasrat'

export type StaffKindClaim = 'OWNER' | 'TRAINER' | 'DESK'

export interface StaffClaims {
  typ: 'staff'
  sub: string
  gid: string
  slug: string
  kind: StaffKindClaim
  name: string
  perms: string[]
  bid: string | null
  desk: boolean
  fam: string
  // Set only when a super admin is impersonating this owner.
  imp?: string
  impName?: string
  ro?: boolean
}

export interface AthleteClaims {
  typ: 'athlete'
  sub: string
  gid: string
  slug: string
  name: string
  lang: 'EN' | 'HI' | 'PA'
  fam: string
}

export interface AdminClaims {
  typ: 'admin'
  sub: string
  aid: string
  name: string
  fam: string
}

export type GymClaims = StaffClaims | AthleteClaims
export type AnyClaims = GymClaims | AdminClaims

export type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: 'missing' | 'expired' | 'invalid' }

function secretFor(audience: 'gym' | 'admin'): Uint8Array {
  const name = audience === 'admin' ? 'JWT_ADMIN_SECRET' : 'JWT_SECRET'
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set and at least 32 characters`)
  }
  return new TextEncoder().encode(value)
}

export async function signAccessToken(claims: AnyClaims, ttlSeconds: number = ACCESS_TTL_SECONDS): Promise<string> {
  const audience = claims.typ === 'admin' ? 'admin' : 'gym'
  const { sub, ...rest } = claims
  return new SignJWT({ ...rest })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretFor(audience))
}

async function verify<T extends AnyClaims>(token: string | undefined | null, audience: 'gym' | 'admin'): Promise<VerifyResult<T>> {
  if (!token) return { ok: false, reason: 'missing' }
  try {
    const { payload } = await jwtVerify(token, secretFor(audience), { issuer: ISSUER, audience })
    return { ok: true, claims: { ...(payload as unknown as T), sub: String(payload.sub) } }
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' }
    return { ok: false, reason: 'invalid' }
  }
}

export async function verifyGymToken(token: string | undefined | null): Promise<VerifyResult<GymClaims>> {
  return verify<GymClaims>(token, 'gym')
}

export async function verifyStaffToken(token: string | undefined | null): Promise<VerifyResult<StaffClaims>> {
  const result = await verify<GymClaims>(token, 'gym')
  if (!result.ok) return result
  return result.claims.typ === 'staff' ? { ok: true, claims: result.claims } : { ok: false, reason: 'invalid' }
}

export async function verifyAthleteToken(token: string | undefined | null): Promise<VerifyResult<AthleteClaims>> {
  const result = await verify<GymClaims>(token, 'gym')
  if (!result.ok) return result
  return result.claims.typ === 'athlete' ? { ok: true, claims: result.claims } : { ok: false, reason: 'invalid' }
}

export async function verifyAdminToken(token: string | undefined | null): Promise<VerifyResult<AdminClaims>> {
  const result = await verify<AdminClaims>(token, 'admin')
  if (!result.ok) return result
  return result.claims.typ === 'admin' ? result : { ok: false, reason: 'invalid' }
}
