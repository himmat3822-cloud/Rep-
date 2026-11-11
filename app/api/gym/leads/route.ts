import { gymRoute, ok } from '@/lib/api/guard'
import { leadSchema } from '@/lib/validation/growth'
import { createLead } from '@/lib/owner/leads'
import { audit } from '@/lib/audit'

// POST /api/gym/leads - add a lead (walk-in at the desk, Instagram DM, call...)
export const POST = gymRoute({ permission: 'leads.manage', feature: 'leads_crm', schema: leadSchema }, async ({ db, gym, input, staff, meta }) => {
  const lead = await createLead(db, gym.id, input)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff!.imp ?? null, action: 'lead.create', entity: 'Lead', entityId: lead.id, meta: { source: lead.source }, ip: meta.ip })
  return ok({ id: lead.id }, { status: 201 })
})
