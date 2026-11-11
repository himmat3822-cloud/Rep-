import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { errorResponse, errors } from '@/lib/api/errors'
import { isCronAuthorized } from '@/lib/cron/auth'
import { runMotivationJobs } from '@/lib/messaging/jobs'

// GET /api/cron/motivation - daily (00:20 IST): one motivation line per
// member in their language (Groq, with the static list as fallback).
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) throw errors.unauthenticated('Invalid cron secret')
    const results = await runMotivationJobs(prisma)
    return NextResponse.json({ ok: true, gyms: results.length, results })
  } catch (error) {
    return errorResponse(error)
  }
}
