import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { staffSchema } from '@/lib/validation/owner'
import { isPermission } from '@/lib/auth/permissions'
import { revokeAllForPrincipal } from '@/lib/auth/session'
import { audit } from '@/lib/audit'

// PATCH /api/gym/staff/{id} - edit details, permission toggles, enable/disable.
// Disabling also ends every session of that person right away.
export const PATCH = gymRoute({ permission: 'staff.manage', schema: staffSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const user = await db.gymUser.findFirst({ where: { id: params.id } })
  if (!user) throw errors.notFound('Staff member')
  if (user.kind === 'OWNER') throw new ApiError(422, 'VALIDATION_ERROR', 'The owner account is managed from Settings > Gym')
  const clash = await db.gymUser.findFirst({ where: { phone: input.phone, id: { not: user.id } }, select: { name: true } })
  if (clash) throw new ApiError(409, 'CONFLICT', `${clash.name} already uses this number here`)
  const role = await db.role.findFirst({ where: { key: input.kind } })
  const updated = await db.gymUser.update({
    where: { id: user.id },
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      kind: input.kind,
      roleId: role?.id ?? user.roleId,
      branchId: input.branchId ?? null,
      grants: input.grants.filter(isPermission),
      denies: input.denies.filter(isPermission),
      commissionPct: input.commissionPct,
      ptSessionFeePaise: Math.round(input.ptSessionFeeRupees * 100),
      active: input.active,
    },
  })
  if (!input.active && user.active) await revokeAllForPrincipal('staff', user.id)
  await audit({
    gymId: gym.id,
    actorType: 'STAFF',
    actorId: staff!.sub,
    impersonatedBy: staff?.imp ?? null,
    action: 'staff.update',
    entity: 'GymUser',
    entityId: user.id,
    meta: { before: { kind: user.kind, grants: user.grants, denies: user.denies, active: user.active }, after: { kind: updated.kind, grants: updated.grants, denies: updated.denies, active: updated.active } },
    ip: meta.ip,
  })
  return ok({ ok: true })
})
