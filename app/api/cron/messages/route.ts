import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { errorResponse, errors } from '@/lib/api/errors'
import { isCronAuthorized } from '@/lib/cron/auth'
import { runMessageJobs } from '@/lib/messaging/jobs'
import { cronForceSchema } from '@/lib/validation/messaging'

// GET /api/cron/messages - dues + renewal reminders, wishes, weekly report
// cards and slot reminders. Safe to call hourly or daily (see lib/messaging/jobs.ts).
// ?force=dues,wishes runs those jobs now even if they already ran today.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) throw errors.unauthenticated('Invalid cron secret')
    const parsed = cronForceSchema.safeParse(new URL(request.url).searchParams.get('force') ?? undefined)
    if (!parsed.success) throw errors.validation('force must be a list of: dues, renewals, wishes, weekly, slots')
    const results = await runMessageJobs(prisma, new Date(), { force: parsed.data })
    await prisma.jobRun.deleteMany({ where: { ranAt: { lt: new Date(Date.now() - 45 * 86400000) } } })
    return NextResponse.json({ ok: true, gyms: results.length, results })
  } catch (error) {
    return errorResponse(error)
  }
}
