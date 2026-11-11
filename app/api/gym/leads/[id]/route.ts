import { gymRoute, ok } from '@/lib/api/guard'
import { leadUpdateSchema } from '@/lib/validation/growth'
import { updateLead } from '@/lib/owner/leads'

// PATCH /api/gym/leads/{id} - move stage, reschedule follow-up, reassign, mark lost
export const PATCH = gymRoute({ permission: 'leads.manage', feature: 'leads_crm', schema: leadUpdateSchema }, async ({ db, params, input }) => {
  const lead = await updateLead(db, params.id, input)
  return ok({ id: lead.id, stage: lead.stage })
})
