import { createHmac, timingSafeEqual } from 'node:crypto'
import { appUrl, requireEnv } from '@/lib/env'

// Signed link to a single due: https://<app>/p/<dueId>.<sig>
// Sent inside dues reminders. Opens a public page with the amount and the
// gym's UPI QR - no login needed, nothing else about the member is shown.
// (When a payment gateway is added later, the same page can take payments.)

const SIG_LENGTH = 22

function signature(dueId: string): string {
  return createHmac('sha256', requireEnv('QR_SECRET')).update(`kp1:${dueId}`).digest('base64url').slice(0, SIG_LENGTH)
}

export function payToken(dueId: string): string {
  return `${dueId}.${signature(dueId)}`
}

export function payLinkUrl(dueId: string): string {
  return `${appUrl()}/p/${payToken(dueId)}`
}

export function verifyPayToken(token: string): string | null {
  const match = /^([a-z0-9]{10,40})\.([A-Za-z0-9_-]{22})$/.exec(token)
  if (!match) return null
  const [, dueId, sig] = match
  const expected = Buffer.from(signature(dueId))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given) ? dueId : null
}
