import { gymRoute, ok } from '@/lib/api/guard'
import { ptLogSchema } from '@/lib/validation/trainer'
import { logPtSession } from '@/lib/trainer/service'

// POST /api/gym/pt-sessions - log a PT session; the member confirms it in their app
export const POST = gymRoute({ allow: ['staff'], permission: 'pt.log', feature: 'pt_tracking', schema: ptLogSchema }, async ({ db, gym, staff, input }) => {
  const session = await logPtSession(db, { id: gym.id, slug: gym.slug }, staff!, input)
  return ok({ id: session.id, commissionPaise: session.commissionPaise }, { status: 201 })
})
