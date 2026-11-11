import { NextResponse, type NextRequest } from 'next/server'
import { verifyAdminToken, verifyAthleteToken, verifyStaffToken, type StaffClaims } from '@/lib/auth/jwt'

// Next.js 16 "proxy" (formerly middleware). Runs before every page request:
//   1. {slug}.kasrat.app  ->  rewrite to /g/{slug}/...
//   2. page-level auth for /admin, /owner, /desk, /trainer and /g/{slug}
//      (expired access token -> silent refresh via /api/auth/refresh)
//   3. security headers
// API routes are NOT gated here: every route handler runs the full guard
// (auth -> permission -> tenant -> zod -> live subscription status).

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api', 'static', 'cdn'])
const ATHLETE_PUBLIC_SEGMENTS = new Set(['login', 'manifest.webmanifest', 'sw.js', 'offline', 'join', 'enquire'])

const COOKIE = {
  staff: 'k_s_at',
  athlete: 'k_a_at',
  admin: 'k_adm_at',
}

function withHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()')
  // Browsers remember to use HTTPS only (production, where Vercel serves TLS).
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  return response
}

function redirect(request: NextRequest, path: string): NextResponse {
  return withHeaders(NextResponse.redirect(new URL(path, request.url)))
}

function staffHome(claims: StaffClaims): string {
  if (claims.kind === 'OWNER') return '/owner'
  if (claims.kind === 'TRAINER') return '/trainer'
  return '/desk'
}

function staffAreaAllowed(area: string, kind: StaffClaims['kind']): boolean {
  if (area === 'owner') return kind === 'OWNER'
  if (area === 'desk') return kind === 'DESK' || kind === 'OWNER'
  if (area === 'trainer') return kind === 'TRAINER' || kind === 'OWNER'
  return false
}

function subdomainSlug(host: string): string | null {
  const root = (process.env.ROOT_DOMAIN ?? 'kasrat.app').toLowerCase()
  const bare = host.split(':')[0].toLowerCase()
  if (!bare.endsWith(`.${root}`)) return null
  const sub = bare.slice(0, -(root.length + 1))
  if (!sub || sub.includes('.') || RESERVED_SUBDOMAINS.has(sub)) return null
  return /^[a-z0-9-]{3,40}$/.test(sub) ? sub : null
}

export async function proxy(request: NextRequest) {
  const original = request.nextUrl.pathname
  let pathname = original
  let rewriteTo: URL | null = null

  // 1. Custom subdomain -> athlete app
  const slugFromHost = subdomainSlug(request.headers.get('host') ?? '')
  if (slugFromHost && !original.startsWith('/api') && !original.startsWith('/g/') && !original.startsWith('/_next')) {
    pathname = `/g/${slugFromHost}${original === '/' ? '' : original}`
    rewriteTo = new URL(pathname + request.nextUrl.search, request.url)
  }

  const nextParam = encodeURIComponent(original + request.nextUrl.search)
  const segments = pathname.split('/').filter(Boolean)
  const area = segments[0] ?? ''

  // 2a. Super admin
  if (area === 'admin') {
    const result = await verifyAdminToken(request.cookies.get(COOKIE.admin)?.value)
    if (segments[1] === 'login') {
      if (result.ok) return redirect(request, '/admin')
    } else if (!result.ok) {
      return redirect(request, `/api/admin/auth/refresh?next=${nextParam}`)
    }
  }

  // 2b. Gym staff areas
  if (area === 'owner' || area === 'desk' || area === 'trainer') {
    const result = await verifyStaffToken(request.cookies.get(COOKIE.staff)?.value)
    if (!result.ok) return redirect(request, `/api/auth/refresh?as=staff&next=${nextParam}`)
    if (!staffAreaAllowed(area, result.claims.kind)) return redirect(request, staffHome(result.claims))
  }

  if (area === 'login') {
    const result = await verifyStaffToken(request.cookies.get(COOKIE.staff)?.value)
    if (result.ok) return redirect(request, staffHome(result.claims))
  }

  // 2c. Athlete PWA
  if (area === 'g' && segments[1]) {
    const slug = segments[1]
    const sub = segments[2]
    const result = await verifyAthleteToken(request.cookies.get(COOKIE.athlete)?.value)
    const signedInHere = result.ok && result.claims.slug === slug
    if (sub === 'login') {
      if (signedInHere) return redirect(request, slugFromHost ? '/' : `/g/${slug}`)
    } else if (!sub || !ATHLETE_PUBLIC_SEGMENTS.has(sub)) {
      if (!signedInHere) {
        const refreshNext = encodeURIComponent(pathname + request.nextUrl.search)
        return redirect(request, `/api/auth/refresh?as=athlete&next=${refreshNext}`)
      }
    }
  }

  // 3. Continue (rewritten for subdomains)
  return withHeaders(rewriteTo ? NextResponse.rewrite(rewriteTo) : NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
}
