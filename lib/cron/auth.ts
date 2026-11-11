import { timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@/lib/env'

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${requireEnv('CRON_SECRET')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
