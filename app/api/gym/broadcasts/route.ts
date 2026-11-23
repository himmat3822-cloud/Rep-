import { after } from 'next/server'
import { gymRoute, ok } from '@/lib/api/guard'
import { broadcastSchema, flushAfterBroadcast, recentCampaigns, sendBroadcast } from '@/lib/messaging/broadcast'
import { prisma } from '@/lib/db/client'
import { hitRateLimit } from '@/lib/rate-limit'
import { errors } from '@/lib/api/errors'

// GET  /api/gym/broadcasts                      - recent bulk messages with counts
// POST /api/gym/broadcasts { audience, message } - send to a member group.
// Messages go out right after this returns (or at 8 AM during quiet hours).
export const GET = gymRoute({ permission: 'announcements.manage' }, async ({ db }) => ok({ campaigns: await recentCampaigns(db) }))

export const POST = gymRoute({ permission: 'announcements.manage', schema: broadcastSchema }, async ({ gym, staff, input }) => {
  const limit = await hitRateLimit(prisma, `broadcast:${gym.id}`, 20, 86400)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const result = await sendBroadcast(prisma, { id: gym.id, name: gym.name }, staff!.sub, input)
  if (!result.quiet) after(() => flushAfterBroadcast(prisma, gym.id))
  return ok(result, { status: 201 })
})
