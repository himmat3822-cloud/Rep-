import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { errorResponse, errors } from '@/lib/api/errors'
import { isCronAuthorized } from '@/lib/cron/auth'
import { runAttendanceJobs } from '@/lib/attendance/jobs'
import { runGrowthJobs } from '@/lib/owner/growth-jobs'

// GET /api/cron/attendance - nightly (00:05 IST): auto checkout, membership
// start/expiry, statuses + streaks, next 7 days of slots, peak-hour stats,
// badges, then this week's at-risk list and today's lead follow-ups.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) throw errors.unauthenticated('Invalid cron secret')
    const results = await runAttendanceJobs(prisma)
    await prisma.qrNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    const growth = await runGrowthJobs(prisma)
    return NextResponse.json({ ok: true, gyms: results.length, results, growth })
  } catch (error) {
    return errorResponse(error)
  }
}
