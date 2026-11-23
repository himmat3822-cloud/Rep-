import { gymRoute, ok } from '@/lib/api/guard'
import { cancelBroadcast } from '@/lib/messaging/broadcast'

// DELETE /api/gym/broadcasts/{id} - stop the messages that have not gone out yet
export const DELETE = gymRoute({ permission: 'announcements.manage' }, async ({ db, params }) => ok(await cancelBroadcast(db, params.id)))
