import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { claimSchema } from '@/lib/validation/athlete'
import { submitClaim } from '@/lib/athlete/payments'
import { rupeesToPaise } from '@/lib/money'
import { hitRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db/client'
import { errors } from '@/lib/api/errors'

// POST /api/g/{slug}/me/claims - "I've paid" (UPI ref) for a due or an early renewal
export const POST = athleteRoute({ schema: claimSchema }, async ({ db, gym, me, input }) => {
  const limit = await hitRateLimit(prisma, `claim:${me.id}`, 5, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const settings = await db.gym.findFirst({ select: { settings: true } })
  const claim = await submitClaim(db, { id: gym.id, name: gym.name, settings: settings?.settings }, me, {
    kind: input.kind,
    dueId: input.dueId,
    planId: input.planId,
    amountPaise: rupeesToPaise(input.amountRupees),
    utr: input.utr,
    note: input.note,
  })
  return ok({ id: claim.id, status: claim.status }, { status: 201 })
})
