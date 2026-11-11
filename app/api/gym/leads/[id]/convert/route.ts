import { gymRoute, ok } from '@/lib/api/guard'
import { leadConvertSchema } from '@/lib/validation/growth'
import { convertLead } from '@/lib/owner/leads'
import { audit } from '@/lib/audit'

// POST /api/gym/leads/{id}/convert { homeBranchId } - one click: lead becomes a member.
// The desk then sells a plan from the member page as usual.
export const POST = gymRoute({ permission: ['leads.manage', 'members.write'], feature: 'leads_crm', schema: leadConvertSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const row = await db.gym.findFirst({ select: { settings: true } })
  const result = await convertLead(db, { id: gym.id, name: gym.name, settings: row?.settings }, params.id, input.homeBranchId)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff!.imp ?? null, action: 'lead.convert', entity: 'Lead', entityId: params.id, meta: { athleteId: result.athleteId }, ip: meta.ip })
  return ok(result, { status: 201 })
})
