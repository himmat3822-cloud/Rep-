import { adminRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { claimDecisionSchema } from '@/lib/validation/owner'
import { recordPlatformPayment } from '@/lib/platform/billing-service'
import { notifyGymOwners } from '@/lib/platform/notify'
import { audit } from '@/lib/audit'
import { formatInrExact } from '@/lib/money'

// POST /api/admin/claims/{id} { action: approve | reject, reason }
// Approve = record the payment (Rep+ invoice) and restore the gym.
export const POST = adminRoute({ schema: claimDecisionSchema }, async ({ params, input, admin, meta }) => {
  const claim = await prisma.platformPaymentClaim.findUnique({ where: { id: params.id } })
  if (!claim) throw errors.notFound('Payment claim')
  if (claim.status !== 'PENDING') throw new ApiError(409, 'CONFLICT', 'This claim was already decided')

  if (input.action === 'approve') {
    const { invoice } = await recordPlatformPayment(prisma, {
      gymId: claim.gymId,
      totalPaise: claim.amountPaise,
      paidAt: claim.createdAt,
      actor: { type: 'ADMIN', id: admin.sub, adminUserId: admin.sub, ip: meta.ip },
      note: `${claim.method} ${claim.reference}`,
    })
    await prisma.platformPaymentClaim.update({ where: { id: claim.id }, data: { status: 'APPROVED', decidedBy: admin.sub, decidedAt: new Date(), decision: input.reason, invoiceId: invoice.id } })
    await notifyGymOwners(prisma, claim.gymId, { title: 'Payment received', body: `We received ${formatInrExact(claim.amountPaise)} (ref ${claim.reference}). Thank you! Invoice ${invoice.number}.`, href: '/owner/billing', email: true })
    return ok({ status: 'APPROVED', invoiceNumber: invoice.number })
  }

  await prisma.platformPaymentClaim.update({ where: { id: claim.id }, data: { status: 'REJECTED', decidedBy: admin.sub, decidedAt: new Date(), decision: input.reason } })
  await audit({ gymId: claim.gymId, actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'billing.claim_rejected', entity: 'PlatformPaymentClaim', entityId: claim.id, reason: input.reason, ip: meta.ip })
  await notifyGymOwners(prisma, claim.gymId, { title: 'Payment could not be verified', body: `We could not find payment ref ${claim.reference}: ${input.reason}. Please check and submit again.`, href: '/owner/billing', email: true })
  return ok({ status: 'REJECTED' })
})
