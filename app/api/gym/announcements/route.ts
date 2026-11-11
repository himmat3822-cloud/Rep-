import { gymRoute, ok } from '@/lib/api/guard'
import { announcementSchema } from '@/lib/validation/growth'
import { publishAnnouncement } from '@/lib/owner/engagement'
import { audit } from '@/lib/audit'

// POST /api/gym/announcements - "Gym closed on Diwali", shown on the member
// home screen and sent to the bell + push. Free: no WhatsApp quota used.
export const POST = gymRoute({ permission: 'announcements.manage', schema: announcementSchema }, async ({ db, gym, input, staff, meta }) => {
  const result = await publishAnnouncement(db, gym, staff!.sub, input)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff!.imp ?? null, action: 'announcement.publish', entity: 'Announcement', entityId: result.announcement.id, meta: { notified: result.notified, pushed: result.pushed }, ip: meta.ip })
  return ok({ id: result.announcement.id, notified: result.notified, pushed: result.pushed }, { status: 201 })
})
