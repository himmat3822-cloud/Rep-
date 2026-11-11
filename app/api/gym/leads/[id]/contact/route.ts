import { gymRoute, ok } from '@/lib/api/guard'
import { leadContactSchema } from '@/lib/validation/growth'
import { logLeadContact } from '@/lib/owner/leads'

// POST /api/gym/leads/{id}/contact { note, nextFollowUpAt?, stage? } - log a call/visit
export const POST = gymRoute({ permission: 'leads.manage', feature: 'leads_crm', schema: leadContactSchema }, async ({ db, params, input, staff }) => {
  const person = await db.gymUser.findFirst({ where: { id: staff!.sub }, select: { name: true } })
  const lead = await logLeadContact(db, params.id, person?.name.split(/\s+/)[0] ?? 'Staff', input)
  return ok({ id: lead.id, stage: lead.stage, nextFollowUpAt: lead.nextFollowUpAt })
})
