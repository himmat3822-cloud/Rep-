import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { parseGymSettings } from '@/lib/gym/settings'
import { BRANCH_COOKIE } from '@/lib/owner/branch-view'
import { audit } from '@/lib/audit'
import { isProduction } from '@/lib/env'

// Owner dashboard style for multi-branch gyms.
//   POST  { branchId }  open one branch (separate mode). Only sets a cookie
//                       for this browser; nothing in the gym changes, so a
//                       read-only support session may use it too.
//   POST  { branchId: null } forget the chosen branch (back to the picker).
//   PATCH { mode }      'combined' or 'separate' for this gym.

const COOKIE_DAYS = 180
const pickSchema = z.object({ branchId: z.string().min(1).max(40).nullable() })

export const POST = gymRoute({ permission: 'settings.manage', schema: pickSchema, write: false }, async ({ db, gym, input, staff }) => {
  if (staff?.kind !== 'OWNER') throw errors.forbidden('Only the owner picks the branch view')
  const response = NextResponse.json({ ok: true })
  if (!input.branchId) {
    response.cookies.set(BRANCH_COOKIE, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: 0 })
    return response
  }
  const branch = await db.branch.findFirst({ where: { id: input.branchId, archived: false }, select: { id: true } })
  if (!branch) throw errors.notFound('Branch')
  response.cookies.set(BRANCH_COOKIE, `${gym.id}:${branch.id}`, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: COOKIE_DAYS * 86400 })
  return response
})

const modeSchema = z.object({ mode: z.enum(['combined', 'separate']) })

export const PATCH = gymRoute({ permission: 'settings.manage', schema: modeSchema }, async ({ db, gym, input, staff, meta }) => {
  if (staff?.kind !== 'OWNER') throw errors.forbidden('Only the owner picks the dashboard style')
  const row = await db.gym.findFirst({ select: { settings: true } })
  const current = parseGymSettings(row?.settings)
  if (current.ownerView !== input.mode) {
    await db.gym.update({ where: { id: gym.id }, data: { settings: { ...current, ownerView: input.mode } } })
    await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff.sub, impersonatedBy: staff.imp ?? null, action: 'settings.ownerView', entity: 'Gym', entityId: gym.id, meta: { from: current.ownerView, to: input.mode }, ip: meta.ip })
  }
  return ok({ ok: true, mode: input.mode })
})
