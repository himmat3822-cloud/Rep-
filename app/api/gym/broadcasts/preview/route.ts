import { gymRoute, ok } from '@/lib/api/guard'
import { broadcastSchema, previewBroadcast } from '@/lib/messaging/broadcast'
import { prisma } from '@/lib/db/client'

// POST /api/gym/broadcasts/preview { audience, message } - how many members
// match, a sample of what they will read, and the WhatsApp count. Saves nothing.
export const POST = gymRoute({ permission: 'announcements.manage', schema: broadcastSchema, write: false }, async ({ gym, input }) =>
  ok(await previewBroadcast(prisma, { id: gym.id, name: gym.name }, input.audience, input.message)),
)
