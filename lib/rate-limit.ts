import type { PrismaClient } from '@/lib/generated/prisma/client'

// Fixed-window limiter stored in Postgres (table RateLimitHit). One atomic
// upsert per hit, so it works across Vercel serverless instances.
// Old windows are deleted by the daily cleanup cron.

export interface RateLimitResult {
  ok: boolean
  count: number
  limit: number
  retryAfterSeconds: number
}

export async function hitRateLimit(db: PrismaClient, key: string, limit: number, windowSeconds: number, now: Date = new Date()): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "RateLimitHit"."count" + 1
    RETURNING "count"
  `
  const count = Number(rows[0]?.count ?? 1)
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000))
  return { ok: count <= limit, count, limit, retryAfterSeconds }
}

export async function purgeOldRateLimits(db: PrismaClient, olderThanHours = 48): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000)
  const result = await db.rateLimitHit.deleteMany({ where: { windowStart: { lt: cutoff } } })
  return result.count
}
