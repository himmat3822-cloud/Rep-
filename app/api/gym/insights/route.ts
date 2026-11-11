import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { hitRateLimit } from '@/lib/rate-limit'
import { ownerInsights } from '@/lib/owner/insights'

// POST /api/gym/insights - Elite: plain-language advice from this month's
// numbers (Groq LLaMA, with rule-based insights when AI is unavailable).
export const POST = gymRoute({ permission: 'reports.read', feature: 'ai_insights' }, async ({ db, gym }) => {
  const limit = await hitRateLimit(prisma, `insights:${gym.id}`, 10, 86400)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const result = await ownerInsights(db, gym.name)
  return ok({ source: result.source, insights: result.insights })
})
