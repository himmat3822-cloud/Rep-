import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { updateGymSchema } from '@/lib/validation/admin'
import { assertSlugAvailable, getGymDetail } from '@/lib/platform/gyms'

// GET /api/admin/gyms/{id}
export const GET = adminRoute({}, async ({ params }) => {
  const detail = await getGymDetail(prisma, params.id)
  if (!detail) throw errors.notFound('Gym')
  return ok(detail)
})

// PATCH /api/admin/gyms/{id} - profile, link, plan and billing cycle.
// A plan change applies from the next invoice; nothing is charged here.
export const PATCH = adminRoute({ schema: updateGymSchema }, async ({ params, input, admin, meta }) => {
  const gym = await prisma.gym.findUnique({ where: { id: params.id }, include: { subscription: true } })
  if (!gym || !gym.subscription) throw errors.notFound('Gym')
  await assertSlugAvailable(prisma, input.slug, gym.id)
  const plan = await prisma.platformPlan.findUnique({ where: { id: input.planId } })
  if (!plan) throw errors.validation('Unknown plan')
  if (plan.archived && plan.id !== gym.subscription.planId) throw errors.validation('Archived plans cannot be assigned to new gyms')

  await prisma.$transaction([
    prisma.gym.update({
      where: { id: gym.id },
      data: { name: input.name, slug: input.slug, city: input.city, address: input.address, gstNumber: input.gstNumber || null, ownerHandlesDesk: input.ownerHandlesDesk },
    }),
    prisma.gymSubscription.update({ where: { gymId: gym.id }, data: { planId: input.planId, cycle: input.cycle } }),
  ])
  await audit({
    gymId: gym.id,
    actorType: 'ADMIN',
    actorId: admin.sub,
    adminUserId: admin.sub,
    action: 'gym.update',
    entity: 'Gym',
    entityId: gym.id,
    meta: {
      before: { name: gym.name, slug: gym.slug, planId: gym.subscription.planId, cycle: gym.subscription.cycle, ownerHandlesDesk: gym.ownerHandlesDesk },
      after: { name: input.name, slug: input.slug, planId: input.planId, cycle: input.cycle, ownerHandlesDesk: input.ownerHandlesDesk },
    },
    ip: meta.ip,
  })
  return ok({ ok: true })
})
