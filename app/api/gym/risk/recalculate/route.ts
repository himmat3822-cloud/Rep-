import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { hitRateLimit } from '@/lib/rate-limit'
import { computeWeeklyRisk } from '@/lib/owner/risk'

// POST /api/gym/risk/recalculate - refresh this week's list now (the cron
// does it every night; this is for "I just collected 5 payments").
export const POST = gymRoute({ permission: 'risk.manage', feature: 'at_risk' }, async ({ db, gym }) => {
  const limit = await hitRateLimit(prisma, `risk:${gym.id}`, 6, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  return ok(await computeWeeklyRisk(db, gym.id))
})
