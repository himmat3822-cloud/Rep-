import { gymRoute, ok } from '@/lib/api/guard'
import { claimDecisionSchema } from '@/lib/validation/athlete'
import { rejectClaim } from '@/lib/athlete/payments'
import { actorFrom } from '@/lib/owner/actor'
import { audit } from '@/lib/audit'

// POST /api/gym/claims/{id}/reject { reason } - could not find the money
export const POST = gymRoute({ permission: 'payments.collect', schema: claimDecisionSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const result = await rejectClaim(db, { id: gym.id, slug: gym.slug, name: gym.name }, params.id, input.reason, actorFrom(staff, meta))
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'claim.reject', entity: 'MemberPaymentClaim', entityId: params.id, reason: input.reason, ip: meta.ip })
  return ok(result)
})
