import { createHmac, timingSafeEqual } from 'node:crypto'
import { optionalEnv, requireEnv } from '@/lib/env'

// Razorpay helpers. Webhook signature = HMAC-SHA256(raw body, webhook secret),
// hex encoded, sent in the X-Razorpay-Signature header.

export function verifyRazorpaySignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export function razorpayWebhookSecret(): string {
  return requireEnv('RAZORPAY_WEBHOOK_SECRET')
}

export function razorpayConfigured(): boolean {
  return Boolean(optionalEnv('RAZORPAY_KEY_ID') && optionalEnv('RAZORPAY_KEY_SECRET'))
}

export async function razorpayRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const auth = Buffer.from(`${requireEnv('RAZORPAY_KEY_ID')}:${requireEnv('RAZORPAY_KEY_SECRET')}`).toString('base64')
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: { description?: string } }
  if (!response.ok) throw new Error(`Razorpay ${path} failed: ${data.error?.description ?? response.statusText}`)
  return data
}

// Shapes of the webhook payload parts we read.
export interface RazorpayWebhook {
  event: string
  created_at?: number
  payload: {
    subscription?: { entity: { id: string; status?: string; notes?: Record<string, string>; current_end?: number | null } }
    payment?: { entity: { id: string; amount: number; currency: string; status?: string; created_at?: number; notes?: Record<string, string> } }
    invoice?: { entity: { id: string; subscription_id?: string | null; amount_paid?: number } }
    payment_link?: { entity: { id: string; notes?: Record<string, string> } }
  }
}
