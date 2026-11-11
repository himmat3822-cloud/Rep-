import { gymRoute, ok } from '@/lib/api/guard'
import { approveClaim } from '@/lib/athlete/payments'
import { actorFrom } from '@/lib/owner/actor'

// POST /api/gym/claims/{id}/approve - the UPI money is in the bank: record payment + invoice
export const POST = gymRoute({ permission: 'payments.collect', write: true }, async ({ db, gym, params, staff, meta }) => {
  const row = await db.gym.findFirst({ select: { settings: true } })
  return ok(await approveClaim(db, { id: gym.id, slug: gym.slug, name: gym.name, settings: row?.settings }, params.id, actorFrom(staff, meta)))
})
