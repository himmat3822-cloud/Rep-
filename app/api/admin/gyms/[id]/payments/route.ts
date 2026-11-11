import { adminRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { markPaidSchema } from '@/lib/validation/admin'
import { rupeesToPaise } from '@/lib/money'
import { recordPlatformPayment } from '@/lib/platform/billing-service'

// POST /api/admin/gyms/{id}/payments - record an offline payment (bank
// transfer, cheque). Amount is the total incl. GST. Restores the gym.
export const POST = adminRoute({ schema: markPaidSchema }, async ({ params, input, admin, meta }) => {
  const exists = await prisma.gymSubscription.findUnique({ where: { gymId: params.id }, select: { id: true } })
  if (!exists) throw errors.notFound('Gym')
  const { invoice } = await recordPlatformPayment(prisma, {
    gymId: params.id,
    totalPaise: rupeesToPaise(input.amountRupees),
    paidAt: new Date(),
    actor: { type: 'ADMIN', id: admin.sub, adminUserId: admin.sub, ip: meta.ip },
    note: `offline payment: ${input.reference}`,
  })
  return ok({ invoiceNumber: invoice.number }, { status: 201 })
})
