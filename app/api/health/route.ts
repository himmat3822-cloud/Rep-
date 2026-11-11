import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

// GET /api/health - for uptime monitors (UptimeRobot, Better Stack) and the
// post-deploy smoke test. Says only whether the app and database answer;
// never secrets, versions of dependencies or tenant data.
export const dynamic = 'force-dynamic'

export async function GET() {
  const started = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, db: 'up', ms: Date.now() - started, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
