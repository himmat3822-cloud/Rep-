import { gymRoute, ok } from '@/lib/api/guard'
import { sellSchema } from '@/lib/validation/owner'
import { sellMembership } from '@/lib/owner/money'
import { actorFrom } from '@/lib/owner/actor'
import { rupeesToPaise } from '@/lib/money'
import { notifyReferral } from '@/lib/athlete/payments'

// POST /api/gym/members/{id}/memberships - sell / renew a plan, take payment,
// issue the GST invoice, and open a due for any balance.
export const POST = gymRoute({ permission: 'payments.collect', feature: 'membership_plans', schema: sellSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const settings = await db.gym.findFirst({ select: { settings: true } })
  const result = await sellMembership(
    db,
    { id: gym.id, name: gym.name, settings: settings?.settings },
    {
      athleteId: params.id,
      planId: input.planId,
      startsOn: input.startsOn ?? null,
      discountPaise: rupeesToPaise(input.discountRupees),
      amountPaidPaise: rupeesToPaise(input.amountPaidRupees),
      method: input.method,
      includeJoiningFee: input.includeJoiningFee,
      note: input.note,
    },
    actorFrom(staff, meta),
  )
  await notifyReferral(db, { id: gym.id, slug: gym.slug, name: gym.name }, result.referral)
  return ok(
    {
      membershipId: result.membership.id,
      startsAt: result.membership.startsAt,
      endsAt: result.membership.endsAt,
      invoiceId: result.invoice?.id ?? null,
      invoiceNumber: result.invoice?.number ?? null,
      duePaise: result.due?.amountPaise ?? 0,
    },
    { status: 201 },
  )
})
