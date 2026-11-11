import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { signAccessToken, verifyAdminToken, verifyAthleteToken, verifyStaffToken } from '@/lib/auth/jwt'
import { isCronAuthorized } from '@/lib/cron/auth'
import { COMING_SOON, ELITE_FEATURES, FEATURES, PRO_FEATURES, resolveFeatures, SOLO_FEATURES } from '@/lib/features'
import { overrideSchema, planSchema } from '@/lib/validation/admin'

// Phase 10 security pass: every API route has a guard, tokens can't be
// forged or tampered with, cron needs its secret, and coming-soon features
// can never be sold or switched on.

const ROOT = join(__dirname, '..')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...routeFiles(path))
    else if (name === 'route.ts') out.push(relative(ROOT, path).replace(/\\/g, '/'))
  }
  return out.sort()
}

// Routes that authenticate in their own way, each with the reason.
const SELF_GUARDED: Record<string, string> = {
  'app/api/auth/login/route.ts': 'login itself (rate limited)',
  'app/api/auth/logout/route.ts': 'clears cookies only',
  'app/api/auth/refresh/route.ts': 'rotating refresh token cookie',
  'app/api/auth/otp/request/route.ts': 'requests an OTP (rate limited)',
  'app/api/auth/otp/verify/route.ts': 'verifies an OTP (rate limited)',
  'app/api/admin/auth/login/route.ts': 'admin password + TOTP (rate limited)',
  'app/api/admin/auth/logout/route.ts': 'clears cookies only',
  'app/api/admin/auth/refresh/route.ts': 'rotating admin refresh token cookie',
  'app/api/signup/route.ts': 'public gym signup (OTP verified)',
  'app/api/signup/otp/route.ts': 'public signup OTP (rate limited)',
  'app/api/signup/verify/route.ts': 'public signup OTP check',
  'app/api/signup/slug/route.ts': 'public slug availability',
  'app/api/devices/punches/route.ts': 'hashed per-device API key',
  'app/api/webhooks/whatsapp/route.ts': 'Meta signature (X-Hub-Signature-256)',
  'app/api/webhooks/razorpay/route.ts': 'Razorpay signature',
  'app/api/health/route.ts': 'public uptime check, no data',
  'app/api/g/[slug]/occupancy/route.ts': 'public crowd counts, no names',
  'app/api/g/[slug]/join/route.ts': 'public referral form (rate limited)',
  'app/api/g/[slug]/enquire/route.ts': 'public enquiry form (rate limited, honeypot)',
}

// Gym routes allowed without a `permission:` key, with the reason.
const GYM_ROUTE_NO_PERMISSION: Record<string, string> = {
  'app/api/auth/me/route.ts': 'returns the caller only',
  'app/api/gym/invoices/[id]/pdf/route.ts': 'checks payments.read or invoice owner inline',
  'app/api/gym/notifications/route.ts': 'the caller\'s own notifications only',
  'app/api/g/[slug]/checkin/route.ts': 'members check themselves in',
  'app/api/g/[slug]/me/language/route.ts': 'member changes own language',
  'app/api/g/[slug]/me/qr-key/route.ts': 'member gets own QR key',
}

describe('API route guards (static inventory)', () => {
  const files = routeFiles(join(ROOT, 'app/api'))

  it('finds the API routes', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it.each(files)('%s is guarded', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    const handlers = (src.match(/export (const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
    expect(handlers, 'route exports no handler').toBeGreaterThan(0)
    if (SELF_GUARDED[file]) return
    if (file.startsWith('app/api/cron/')) {
      expect(src).toContain('isCronAuthorized(request)')
      return
    }
    if (file.startsWith('app/api/admin/')) {
      expect((src.match(/adminRoute\(/g) ?? []).length).toBe(handlers)
      return
    }
    const guards = (src.match(/\b(gymRoute|athleteRoute)\(/g) ?? []).length
    expect(guards, 'every handler needs gymRoute or athleteRoute').toBe(handlers)
    if (file.startsWith('app/api/gym/') && !GYM_ROUTE_NO_PERMISSION[file]) {
      const gymGuards = (src.match(/gymRoute\(/g) ?? []).length
      const withPermission = (src.match(/gymRoute\(\{[^)]*permission:/g) ?? []).length
      expect(withPermission, 'staff routes must name a permission').toBe(gymGuards)
    }
  })

  it('the allowlists only name routes that exist', () => {
    for (const file of [...Object.keys(SELF_GUARDED), ...Object.keys(GYM_ROUTE_NO_PERMISSION)]) expect(files).toContain(file)
  })
})

describe('tokens', () => {
  const staff = { typ: 'staff' as const, sub: 'u1', gid: 'g1', slug: 'forge', kind: 'OWNER' as const, name: 'Owner', perms: ['members.read'], bid: null, desk: false, fam: 'f1' }

  it('a tampered payload is rejected', async () => {
    const token = await signAccessToken(staff)
    const [head, body, sig] = token.split('.')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
    claims.perms = ['staff.manage', 'billing.manage']
    const forged = [head, Buffer.from(JSON.stringify(claims)).toString('base64url'), sig].join('.')
    expect((await verifyStaffToken(forged)).ok).toBe(false)
  })

  it('an unsigned (alg none) token is rejected', async () => {
    const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ ...staff, iss: 'kasrat', aud: 'gym', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')
    expect((await verifyStaffToken(`${head}.${body}.`)).ok).toBe(false)
  })

  it('an expired token says expired, so the client refreshes', async () => {
    const token = await signAccessToken(staff, -10)
    expect(await verifyStaffToken(token)).toEqual({ ok: false, reason: 'expired' })
  })

  it('a staff token is not a member token and never an admin token', async () => {
    const token = await signAccessToken(staff)
    expect((await verifyStaffToken(token)).ok).toBe(true)
    expect((await verifyAthleteToken(token)).ok).toBe(false)
    expect((await verifyAdminToken(token)).ok).toBe(false)
  })
})

describe('cron secret', () => {
  const call = (auth?: string) => new Request('https://kasrat.app/api/cron/attendance', { headers: auth ? { Authorization: auth } : {} })

  it('needs the exact bearer secret', () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests-1234567890'
    expect(isCronAuthorized(call('Bearer cron-secret-for-tests-1234567890'))).toBe(true)
    expect(isCronAuthorized(call('Bearer cron-secret-for-tests-123456789'))).toBe(false)
    expect(isCronAuthorized(call('cron-secret-for-tests-1234567890'))).toBe(false)
    expect(isCronAuthorized(call())).toBe(false)
  })
})

describe('coming-soon features (health sync)', () => {
  it('health sync is announced but in no plan', () => {
    expect(COMING_SOON.has('health_sync')).toBe(true)
    expect(FEATURES.some((f) => f.key === 'health_sync')).toBe(true)
    for (const plan of [SOLO_FEATURES, PRO_FEATURES, ELITE_FEATURES]) expect(plan).not.toContain('health_sync')
  })

  it('cannot be switched on by an old plan row or a per-gym grant', () => {
    expect(resolveFeatures(['health_sync', 'leads_crm'])).toEqual(['leads_crm'])
    expect(resolveFeatures(['leads_crm'], ['health_sync'])).toEqual(['leads_crm'])
  })

  it('the admin forms refuse it', () => {
    const plan = { code: 'pro', name: 'Pro', monthlyPriceRupees: 1499, annualPriceRupees: 14990, memberLimit: 500, branchLimit: 1, extraBranchRupees: null, staffLimit: 7, trainerLimit: 5, deskLimit: 2, whatsappQuota: 2000 }
    expect(planSchema.safeParse({ ...plan, features: ['leads_crm'] }).success).toBe(true)
    expect(planSchema.safeParse({ ...plan, features: ['leads_crm', 'health_sync'] }).success).toBe(false)
    const override = { customPriceRupees: '', extraMembers: 0, extraBranches: 0, extraStaff: 0, whatsappTopUp: 0 }
    expect(overrideSchema.safeParse({ ...override, extraFeatures: ['ai_insights'] }).success).toBe(true)
    expect(overrideSchema.safeParse({ ...override, extraFeatures: ['health_sync'] }).success).toBe(false)
  })
})

describe('database TLS', () => {
  it('upgrades Neon sslmode=require to verify-full and keeps everything else', async () => {
    const { normalizeConnectionString } = await import('@/lib/db/factory')
    expect(normalizeConnectionString('postgresql://u:p@ep-x-pooler.neon.tech/kasrat?sslmode=require&channel_binding=require')).toBe('postgresql://u:p@ep-x-pooler.neon.tech/kasrat?sslmode=verify-full&channel_binding=require')
    expect(normalizeConnectionString('postgresql://u:p@localhost:5432/kasrat')).toBe('postgresql://u:p@localhost:5432/kasrat')
    expect(normalizeConnectionString('postgresql://u:p@h/db?sslmode=require&uselibpqcompat=true')).toBe('postgresql://u:p@h/db?sslmode=require&uselibpqcompat=true')
    expect(normalizeConnectionString('postgresql://u:p@h/db?sslmode=disable')).toBe('postgresql://u:p@h/db?sslmode=disable')
  })
})

describe('showcase login', () => {
  it('only listed numbers get the fixed code, and only when both settings are set', async () => {
    const { demoCodeFor } = await import('@/lib/auth/otp')
    process.env.DEMO_LOGIN_CODE = '246810'
    process.env.DEMO_LOGIN_PHONES = '+919876530000, +919876531001'
    expect(demoCodeFor('+919876531001')).toBe('246810')
    expect(demoCodeFor('+919999999999')).toBeNull()
    process.env.DEMO_LOGIN_CODE = '12ab'
    expect(demoCodeFor('+919876531001')).toBeNull()
    delete process.env.DEMO_LOGIN_CODE
    delete process.env.DEMO_LOGIN_PHONES
    expect(demoCodeFor('+919876531001')).toBeNull()
  })
})
