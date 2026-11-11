import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { billingClaimSchema } from '@/lib/validation/owner'
import { rupeesToPaise } from '@/lib/money'
import { audit } from '@/lib/audit'

// POST /api/gym/billing/claim - "I paid Rep+ by UPI / bank, here is the UTR".
// Works even when the gym is suspended. The super admin approves it.
export const POST = gymRoute({ permission: 'billing.manage', schema: billingClaimSchema, allowWhenSuspended: true }, async ({ gym, input, staff, meta }) => {
  const pending = await prisma.platformPaymentClaim.findFirst({ where: { gymId: gym.id, status: 'PENDING' } })
  if (pending) throw new ApiError(409, 'CONFLICT', 'You already have a payment waiting for verification. We will confirm it shortly.')
  const duplicate = await prisma.platformPaymentClaim.findFirst({ where: { reference: input.reference, status: { not: 'REJECTED' } } })
  if (duplicate) throw new ApiError(409, 'CONFLICT', 'This transaction reference was already submitted.')
  const claim = await prisma.platformPaymentClaim.create({
    data: { gymId: gym.id, amountPaise: rupeesToPaise(input.amountRupees), method: input.method, reference: input.reference, note: input.note, submittedBy: staff!.sub },
  })
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'billing.claim_submitted', entity: 'PlatformPaymentClaim', entityId: claim.id, meta: { amountPaise: claim.amountPaise, method: claim.method }, ip: meta.ip })
  return ok({ id: claim.id, status: claim.status }, { status: 201 })
})
