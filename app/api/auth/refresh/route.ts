import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, errors } from '@/lib/api/errors'
import { refreshQuerySchema, safeNextPath } from '@/lib/validation/auth'
import { requestMeta, rotateSession } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/session-user'

// POST /api/auth/refresh?as=staff|athlete  -> JSON (used by the client fetch helper)
// GET  /api/auth/refresh?as=...&next=/path -> redirect (used by proxy.ts on page loads)

function loginPathFor(as: 'staff' | 'athlete', next: string): string {
  if (as === 'athlete') {
    const match = next.match(/^\/g\/([a-z0-9-]+)/)
    return match ? `/g/${match[1]}/login?next=${encodeURIComponent(next)}` : '/login'
  }
  return `/login?next=${encodeURIComponent(next)}`
}

export async function POST(request: NextRequest) {
  try {
    const query = refreshQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()))
    const result = await rotateSession(query.as, requestMeta(request))
    if (!result.ok) throw errors.unauthenticated('Session ended. Please log in again.')
    if (result.claims.typ === 'admin') throw errors.unauthenticated()
    return NextResponse.json({ user: toSessionUser(result.claims) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function GET(request: NextRequest) {
  const parsed = refreshQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  const as = parsed.success ? parsed.data.as : 'staff'
  const fallback = as === 'athlete' ? '/' : '/owner'
  const next = safeNextPath(parsed.success ? parsed.data.next : null, fallback)
  const result = await rotateSession(as, requestMeta(request))
  const target = result.ok ? next : loginPathFor(as, next)
  return NextResponse.redirect(new URL(target, request.url))
}
