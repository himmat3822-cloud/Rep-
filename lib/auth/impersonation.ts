import 'server-only'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { isProduction } from '@/lib/env'
import { randomToken } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { ApiError } from '@/lib/api/errors'
import { signAccessToken, type AdminClaims } from './jwt'
import { buildStaffClaims, COOKIE_NAMES, type RequestMeta } from './session'

// Super admin "view as owner" for support.
// - Uses a staff access cookie WITHOUT a refresh token: it simply ends after
//   IMPERSONATION_TTL_SECONDS.
// - Read-only by default (the guard blocks writes); write mode needs a reason
//   and every write is audit-logged.

export const IMPERSONATION_TTL_SECONDS = 30 * 60

export async function startImpersonation(admin: AdminClaims, gymId: string, mode: 'read' | 'write', reason: string, meta: RequestMeta) {
  const owner = await prisma.gymUser.findFirst({ where: { gymId, kind: 'OWNER', active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  if (!owner) throw new ApiError(404, 'NOT_FOUND', 'This gym has no active owner to impersonate')

  // Built directly (not via buildStaffClaims' suspension rule) because
  // support must be able to look at suspended gyms too.
  const base = await buildStaffClaims(owner.id, `imp-${randomToken(8)}`).catch(async (error) => {
    if (error instanceof ApiError && error.code === 'GYM_SUSPENDED') return null
    throw error
  })
  if (!base) throw new ApiError(409, 'CONFLICT', 'Could not build the owner session')

  const token = await signAccessToken({ ...base, imp: admin.sub, impName: admin.name, ro: mode === 'read' }, IMPERSONATION_TTL_SECONDS)
  const jar = await cookies()
  jar.set(COOKIE_NAMES.staff.access, token, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: IMPERSONATION_TTL_SECONDS })
  jar.set(COOKIE_NAMES.staff.refresh, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: COOKIE_NAMES.staff.refreshPath, maxAge: 0 })

  await audit({ gymId, actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, impersonatedBy: admin.sub, action: `impersonation.start_${mode}`, entity: 'GymUser', entityId: owner.id, reason, ip: meta.ip })
  return { ownerName: owner.name }
}

export async function stopImpersonation(admin: AdminClaims, gymId: string | null) {
  const jar = await cookies()
  jar.set(COOKIE_NAMES.staff.access, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: 0 })
  await audit({ gymId, actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, impersonatedBy: admin.sub, action: 'impersonation.stop', entity: 'Gym', entityId: gymId })
}
