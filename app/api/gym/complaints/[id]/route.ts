import { gymRoute, ok } from '@/lib/api/guard'
import { complaintUpdateSchema } from '@/lib/validation/growth'
import { updateComplaint } from '@/lib/owner/engagement'

// PATCH /api/gym/complaints/{id} { status, resolutionNote } - the member is
// told what was done when it is resolved.
export const PATCH = gymRoute({ permission: 'complaints.manage', schema: complaintUpdateSchema }, async ({ db, gym, params, input, staff }) => {
  const row = await updateComplaint(db, gym, params.id, staff!.sub, input)
  return ok({ id: row.id, status: row.status })
})
