import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { staffSchema } from '@/lib/validation/owner'
import { assertCanAdd } from '@/lib/owner/limits'
import { isPermission } from '@/lib/auth/permissions'
import { audit } from '@/lib/audit'

// POST /api/gym/staff - add a trainer or front desk login (WhatsApp OTP)
export const POST = gymRoute({ permission: 'staff.manage', schema: staffSchema }, async ({ db, gym, input, staff, meta }) => {
  await assertCanAdd(db, input.kind === 'TRAINER' ? 'trainer' : 'desk')
  const clash = await db.gymUser.findFirst({ where: { phone: input.phone }, select: { name: true } })
  if (clash) throw new ApiError(409, 'CONFLICT', `${clash.name} already uses this number here`)
  const role = await db.role.findFirst({ where: { key: input.kind } })
  if (!role) throw new ApiError(500, 'INTERNAL_ERROR', 'Role missing for this gym')
  const user = await db.gymUser.create({
    data: {
      gymId: gym.id,
      roleId: role.id,
      kind: input.kind,
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      branchId: input.branchId ?? null,
      grants: input.grants.filter(isPermission),
      denies: input.denies.filter(isPermission),
      commissionPct: input.commissionPct,
      ptSessionFeePaise: Math.round(input.ptSessionFeeRupees * 100),
      active: input.active,
    },
  })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'staff.create', entity: 'GymUser', entityId: user.id, meta: { kind: input.kind, grants: user.grants, denies: user.denies }, ip: meta.ip })
  return ok({ id: user.id }, { status: 201 })
})
