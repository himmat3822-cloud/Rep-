import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { planUpdateSchema } from '@/lib/validation/admin'
import { planData } from '@/lib/platform/plans'

// PATCH /api/admin/plans/{id} - edit prices, limits, features, archive flag.
// Existing gyms keep working: price changes apply from their next invoice.
export const PATCH = adminRoute({ schema: planUpdateSchema }, async ({ params, input, admin, meta }) => {
  const before = await prisma.platformPlan.findUnique({ where: { id: params.id } })
  if (!before) throw errors.notFound('Plan')
  const plan = await prisma.platformPlan.update({ where: { id: params.id }, data: { ...planData(input), ...(input.archived !== undefined ? { archived: input.archived } : {}) } })
  await audit({
    actorType: 'ADMIN',
    actorId: admin.sub,
    adminUserId: admin.sub,
    action: 'plan.update',
    entity: 'PlatformPlan',
    entityId: plan.id,
    meta: { before: { monthly: before.monthlyPricePaise, annual: before.annualPricePaise, features: before.features, archived: before.archived }, after: { monthly: plan.monthlyPricePaise, annual: plan.annualPricePaise, features: plan.features, archived: plan.archived } },
    ip: meta.ip,
  })
  return ok(plan)
})

// DELETE /api/admin/plans/{id} - hard delete if nobody uses it, otherwise archive.
export const DELETE = adminRoute({}, async ({ params, admin, meta }) => {
  const plan = await prisma.platformPlan.findUnique({ where: { id: params.id }, include: { _count: { select: { subscriptions: true } } } })
  if (!plan) throw errors.notFound('Plan')
  if (plan._count.subscriptions > 0) {
    await prisma.platformPlan.update({ where: { id: plan.id }, data: { archived: true } })
    await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'plan.archive', entity: 'PlatformPlan', entityId: plan.id, meta: { subscribers: plan._count.subscriptions }, ip: meta.ip })
    return ok({ archived: true, deleted: false, subscribers: plan._count.subscriptions })
  }
  await prisma.platformPlan.delete({ where: { id: plan.id } })
  await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'plan.delete', entity: 'PlatformPlan', entityId: plan.id, meta: { code: plan.code }, ip: meta.ip })
  return ok({ archived: false, deleted: true, subscribers: 0 })
})
