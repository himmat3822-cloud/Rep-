import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { slotsQuerySchema } from '@/lib/validation/athlete'
import { bookableBranchIds, listSlots } from '@/lib/athlete/slots'
import { getGymFeatures } from '@/lib/gym/features'

// GET /api/g/{slug}/slots?date=YYYY-MM-DD&branchId= - slots with live capacity
export const GET = athleteRoute({ feature: 'slot_booking', schema: slotsQuerySchema }, async ({ db, gym, me, input }) => {
  const branches = await bookableBranchIds(db, me, (await getGymFeatures(gym.id)).includes('cross_branch_access'))
  const branchId = input.branchId ?? me.homeBranchId
  if (!branches.includes(branchId)) throw errors.notFound('Branch')
  const slots = await listSlots(db, me.id, branchId, new Date(`${input.date}T00:00:00Z`))
  return ok({ slots }, { headers: { 'Cache-Control': 'private, no-store' } })
})
