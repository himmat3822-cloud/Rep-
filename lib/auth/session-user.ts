import type { AdminClaims, AthleteClaims, StaffClaims } from './jwt'
import type { AdminSessionUser, AthleteSessionUser, SessionUser, StaffSessionUser } from '@/lib/api/types'

// Converts token claims into the public user shape sent to the browser.
export function toSessionUser(claims: StaffClaims): StaffSessionUser
export function toSessionUser(claims: AthleteClaims): AthleteSessionUser
export function toSessionUser(claims: AdminClaims): AdminSessionUser
export function toSessionUser(claims: StaffClaims | AthleteClaims | AdminClaims): SessionUser
export function toSessionUser(claims: StaffClaims | AthleteClaims | AdminClaims): SessionUser {
  if (claims.typ === 'admin') return { type: 'admin', id: claims.sub, adminId: claims.aid, name: claims.name }
  if (claims.typ === 'athlete') {
    return { type: 'athlete', id: claims.sub, name: claims.name, gymId: claims.gid, gymSlug: claims.slug, language: claims.lang }
  }
  return {
    type: 'staff',
    id: claims.sub,
    name: claims.name,
    kind: claims.kind,
    gymId: claims.gid,
    gymSlug: claims.slug,
    permissions: claims.perms,
    ownerHandlesDesk: claims.desk,
  }
}
