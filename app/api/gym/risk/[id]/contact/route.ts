import { gymRoute, ok } from '@/lib/api/guard'
import { riskContactSchema } from '@/lib/validation/growth'
import { recordRiskContact } from '@/lib/owner/engagement'

// POST /api/gym/risk/{id}/contact { outcome, note } - "called them, coming back Monday"
export const POST = gymRoute({ permission: 'risk.manage', feature: 'at_risk', schema: riskContactSchema }, async ({ db, params, input, staff }) => {
  const row = await recordRiskContact(db, params.id, staff!.sub, input)
  return ok({ id: row.id, outcome: row.outcome, contacted: row.contacted })
})
