import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { overrideSchema } from '@/lib/validation/admin'
import { rupeesToPaise } from '@/lib/money'

// PUT /api/admin/gyms/{id}/override - custom price, extra limits, feature
// grants/removals, WhatsApp credit top-up. Free months and trial extension
// live on /status because they change billing state.
export const PUT = adminRoute({ schema: overrideSchema }, async ({ params, input, admin, meta }) => {
  const gym = await prisma.gym.findUnique({ where: { id: params.id }, include: { override: true } })
  if (!gym) throw errors.notFound('Gym')
  const data = {
    customPricePaise: input.customPriceRupees === null ? null : rupeesToPaise(input.customPriceRupees),
    extraMembers: input.extraMembers,
    extraBranches: input.extraBranches,
    extraStaff: input.extraStaff,
    extraFeatures: input.extraFeatures,
    removedFeatures: input.removedFeatures.filter((key) => !input.extraFeatures.includes(key)),
    whatsappTopUp: input.whatsappTopUp,
    note: input.note || null,
  }
  await prisma.gymOverride.upsert({ where: { gymId: gym.id }, create: { gymId: gym.id, ...data }, update: data })
  const before = gym.override
  await audit({
    gymId: gym.id,
    actorType: 'ADMIN',
    actorId: admin.sub,
    adminUserId: admin.sub,
    action: 'gym.override',
    entity: 'GymOverride',
    entityId: gym.id,
    meta: {
      before: before
        ? { customPricePaise: before.customPricePaise, extraMembers: before.extraMembers, extraBranches: before.extraBranches, extraStaff: before.extraStaff, extraFeatures: before.extraFeatures, removedFeatures: before.removedFeatures, whatsappTopUp: before.whatsappTopUp }
        : null,
      after: data,
    },
    ip: meta.ip,
  })
  return ok({ ok: true })
})
