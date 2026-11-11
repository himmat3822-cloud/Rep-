import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { errorResponse, errors } from '@/lib/api/errors'
import { isCronAuthorized } from '@/lib/cron/auth'
import { runBillingCycle } from '@/lib/platform/billing-service'
import { purgeOldRateLimits } from '@/lib/rate-limit'

// GET /api/cron/billing - daily (see vercel.json).
// Moves gyms through TRIAL / PAST_DUE / READ_ONLY / SUSPENDED, sends owner
// reminders, and cleans old rate-limit rows.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) throw errors.unauthenticated('Invalid cron secret')
    const summary = await runBillingCycle(prisma)
    const purgedRateLimits = await purgeOldRateLimits(prisma)
    return NextResponse.json({ ok: true, ...summary, purgedRateLimits })
  } catch (error) {
    return errorResponse(error)
  }
}
