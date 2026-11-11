import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { tenantDb, type TenantDb } from '@/lib/db/tenant'
import { COOKIE_NAMES, requestMeta, type RequestMeta } from '@/lib/auth/session'
import { verifyAdminToken, verifyAthleteToken, verifyStaffToken, type AdminClaims, type AthleteClaims, type StaffClaims } from '@/lib/auth/jwt'
import { hasPermission, type Permission } from '@/lib/auth/permissions'
import type { FeatureKey } from '@/lib/features'
import { getGymFeatures } from '@/lib/gym/features'
import { audit } from '@/lib/audit'
import { ApiError, errorResponse, errors } from './errors'
import type { SubscriptionStatus } from './types'

// Every gym route runs, in order:
//   1. auth            - valid access token (staff and/or athlete)
//   2. permission      - staff permission keys (never role names)
//   3. tenant          - token gym == URL gym, principal still active, scoped db
//   4. validation      - Zod on body (POST/PUT/PATCH/DELETE) or query (GET)
//   5. subscription    - TRIAL/ACTIVE/PAST_DUE ok, READ_ONLY blocks writes,
//                        SUSPENDED/CANCELLED blocks everything except billing
//   6. feature flag    - optional, from the gym's Rep+ plan + overrides

type RouteParams = { params: Promise<Record<string, string | string[]>> }

export interface GymSnapshot {
  id: string
  slug: string
  name: string
  city: string
  subscriptionStatus: SubscriptionStatus
  ownerHandlesDesk: boolean
  athleteLabel: string
  athleteLabelPlural: string
  defaultLanguage: 'EN' | 'HI' | 'PA'
  timezone: string
  sessionMinutes: number
}

const GYM_SELECT = {
  id: true,
  slug: true,
  name: true,
  city: true,
  subscriptionStatus: true,
  ownerHandlesDesk: true,
  athleteLabel: true,
  athleteLabelPlural: true,
  defaultLanguage: true,
  timezone: true,
  sessionMinutes: true,
} as const

export interface GymContext<TInput> {
  request: NextRequest
  params: Record<string, string>
  claims: StaffClaims | AthleteClaims
  staff: StaffClaims | null
  athlete: AthleteClaims | null
  gym: GymSnapshot
  db: TenantDb
  input: TInput
  meta: RequestMeta
}

export interface GymRouteOptions<S extends z.ZodType | undefined> {
  allow?: Array<'staff' | 'athlete'>
  permission?: Permission | Permission[]
  feature?: FeatureKey
  schema?: S
  write?: boolean
  allowWhenSuspended?: boolean
}

type InputOf<S> = S extends z.ZodType ? z.output<S> : undefined

async function flattenParams(context: RouteParams | undefined): Promise<Record<string, string>> {
  const raw = context?.params ? await context.params : {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) out[key] = Array.isArray(value) ? value.join('/') : value
  return out
}

async function readInput(request: NextRequest, schema: z.ZodType | undefined): Promise<unknown> {
  if (!schema) return undefined
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return schema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  }
  let body: unknown = {}
  const text = await request.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw errors.validation('Request body must be valid JSON')
    }
  }
  return schema.parse(body)
}

export function enforceSubscription(status: SubscriptionStatus, principal: 'staff' | 'athlete', isWrite: boolean, allowWhenSuspended: boolean): void {
  if (status === 'TRIAL' || status === 'ACTIVE' || status === 'PAST_DUE') return
  if (principal === 'athlete') {
    throw new ApiError(403, 'GYM_PAUSED', "Your gym's Rep+ access is paused. Please contact the gym.")
  }
  if (allowWhenSuspended) return
  if (status === 'READ_ONLY') {
    if (isWrite) throw new ApiError(403, 'GYM_READ_ONLY', 'Your Rep+ subscription is unpaid, so the app is read-only. Renew to make changes.')
    return
  }
  throw new ApiError(403, 'GYM_SUSPENDED', 'Your Rep+ subscription is suspended. Only the billing page is available.')
}

export function gymRoute<S extends z.ZodType | undefined = undefined>(options: GymRouteOptions<S>, handler: (ctx: GymContext<InputOf<S>>) => Promise<Response> | Response) {
  const allow = options.allow ?? ['staff']

  return async function route(request: NextRequest, context: RouteParams): Promise<Response> {
    try {
      // 1. auth
      let staff: StaffClaims | null = null
      let athlete: AthleteClaims | null = null
      let sawExpired = false
      if (allow.includes('staff')) {
        const result = await verifyStaffToken(request.cookies.get(COOKIE_NAMES.staff.access)?.value)
        if (result.ok) staff = result.claims
        else if (result.reason === 'expired') sawExpired = true
      }
      if (!staff && allow.includes('athlete')) {
        const result = await verifyAthleteToken(request.cookies.get(COOKIE_NAMES.athlete.access)?.value)
        if (result.ok) athlete = result.claims
        else if (result.reason === 'expired') sawExpired = true
      }
      const claims = staff ?? athlete
      if (!claims) throw sawExpired ? errors.tokenExpired() : errors.unauthenticated()

      // 2. permission
      if (staff && options.permission && !hasPermission(staff.perms, options.permission)) {
        throw errors.forbidden()
      }

      // 3. tenant
      const params = await flattenParams(context)
      if (params.slug && params.slug !== claims.slug) throw errors.notFound('Gym')
      const live = staff
        ? await prisma.gymUser.findFirst({ where: { id: staff.sub, gymId: staff.gid, active: true }, select: { gym: { select: GYM_SELECT } } })
        : await prisma.athlete.findFirst({ where: { id: claims.sub, gymId: claims.gid, archived: false }, select: { gym: { select: GYM_SELECT } } })
      if (!live) throw new ApiError(401, 'ACCOUNT_DISABLED', 'This account is no longer active.')
      const gym = live.gym as GymSnapshot

      // 4. validation
      const input = (await readInput(request, options.schema)) as InputOf<S>

      // 5. subscription status
      const method = request.method.toUpperCase()
      const isWrite = options.write ?? !(method === 'GET' || method === 'HEAD')
      enforceSubscription(gym.subscriptionStatus, staff ? 'staff' : 'athlete', isWrite, Boolean(options.allowWhenSuspended && staff?.kind === 'OWNER'))

      // Admin impersonation: read-only unless the admin chose write mode,
      // and every write made while impersonating is audit-logged.
      if (staff?.imp && isWrite && staff.ro) {
        throw new ApiError(403, 'IMPERSONATION_READ_ONLY', 'You are viewing this gym as admin in read-only mode.')
      }

      // 6. feature flag
      if (options.feature) {
        const features = await getGymFeatures(gym.id)
        if (!features.includes(options.feature)) throw errors.featureLocked(options.feature)
      }

      const meta = requestMeta(request)
      const response = await handler({ request, params, claims, staff, athlete, gym, db: tenantDb(gym.id), input, meta })
      if (staff?.imp && isWrite) {
        await audit({ gymId: gym.id, actorType: 'ADMIN', actorId: staff.imp, adminUserId: staff.imp, impersonatedBy: staff.imp, action: 'impersonation.write', entity: 'Request', entityId: `${method} ${request.nextUrl.pathname}`, meta: { status: response.status }, ip: meta.ip })
      }
      return response
    } catch (error) {
      return errorResponse(error)
    }
  }
}

// ---------------------------------------------------------------------------
// Super admin routes (separate cookie, separate JWT secret)
// ---------------------------------------------------------------------------

export interface AdminContext<TInput> {
  request: NextRequest
  params: Record<string, string>
  admin: AdminClaims
  input: TInput
  meta: RequestMeta
}

export function adminRoute<S extends z.ZodType | undefined = undefined>(options: { schema?: S }, handler: (ctx: AdminContext<InputOf<S>>) => Promise<Response> | Response) {
  return async function route(request: NextRequest, context: RouteParams): Promise<Response> {
    try {
      const result = await verifyAdminToken(request.cookies.get(COOKIE_NAMES.admin.access)?.value)
      if (!result.ok) throw result.reason === 'expired' ? errors.tokenExpired() : errors.unauthenticated()
      const exists = await prisma.adminUser.findUnique({ where: { id: result.claims.sub }, select: { id: true } })
      if (!exists) throw errors.unauthenticated()
      const params = await flattenParams(context)
      const input = (await readInput(request, options.schema)) as InputOf<S>
      return await handler({ request, params, admin: result.claims, input, meta: requestMeta(request) })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

// Public routes (login, OTP, webhooks) still get Zod + the error format.
export function publicRoute<S extends z.ZodType | undefined = undefined>(options: { schema?: S }, handler: (ctx: { request: NextRequest; params: Record<string, string>; input: InputOf<S>; meta: RequestMeta }) => Promise<Response> | Response) {
  return async function route(request: NextRequest, context: RouteParams): Promise<Response> {
    try {
      const params = await flattenParams(context)
      const input = (await readInput(request, options.schema)) as InputOf<S>
      return await handler({ request, params, input, meta: requestMeta(request) })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init)
}
