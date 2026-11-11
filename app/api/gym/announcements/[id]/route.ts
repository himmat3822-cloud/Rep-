import { gymRoute, ok } from '@/lib/api/guard'
import { endAnnouncement } from '@/lib/owner/engagement'

// DELETE /api/gym/announcements/{id} - take it off the member home screen now
export const DELETE = gymRoute({ permission: 'announcements.manage' }, async ({ db, params }) => {
  const row = await endAnnouncement(db, params.id)
  return ok({ id: row.id, ended: true })
})
