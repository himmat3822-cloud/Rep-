import { gymRoute, ok } from '@/lib/api/guard'
import { waiveSchema } from '@/lib/validation/owner'
import { waiveDue } from '@/lib/owner/money'
import { actorFrom } from '@/lib/owner/actor'

// POST /api/gym/dues/{id}/waive { reason }
export const POST = gymRoute({ permission: 'dues.manage', schema: waiveSchema }, async ({ db, gym, params, input, staff, meta }) => {
  await waiveDue(db, gym.id, params.id, input.reason, actorFrom(staff, meta))
  return ok({ waived: true })
})
