import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { bookSchema } from '@/lib/validation/athlete'
import { bookSlot, bookableBranchIds } from '@/lib/athlete/slots'
import { getGymFeatures } from '@/lib/gym/features'

// POST /api/g/{slug}/bookings { slotId, replaceBookingId? } - book or move a slot
export const POST = athleteRoute({ feature: 'slot_booking', schema: bookSchema }, async ({ db, gym, me, input }) => {
  const branches = await bookableBranchIds(db, me, (await getGymFeatures(gym.id)).includes('cross_branch_access'))
  const booking = await bookSlot(db, gym.id, me, input.slotId, branches, { replaceBookingId: input.replaceBookingId })
  return ok(booking, { status: 201 })
})
