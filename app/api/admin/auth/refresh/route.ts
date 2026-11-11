import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, errors } from '@/lib/api/errors'
import { safeNextPath } from '@/lib/validation/auth'
import { requestMeta, rotateSession } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/session-user'

// POST -> JSON for client fetches, GET -> redirect for page loads via proxy.ts
export async function POST(request: NextRequest) {
  try {
    const result = await rotateSession('admin', requestMeta(request))
    if (!result.ok) throw errors.unauthenticated('Admin session ended. Please log in again.')
    return NextResponse.json({ user: toSessionUser(result.claims) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'), '/admin')
  const result = await rotateSession('admin', requestMeta(request))
  const target = result.ok ? next : `/admin/login?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(new URL(target, request.url))
}
