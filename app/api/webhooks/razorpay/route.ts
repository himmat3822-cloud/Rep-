import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { razorpayWebhookSecret, verifyRazorpaySignature, type RazorpayWebhook } from '@/lib/integrations/razorpay'
import { processRazorpayEvent } from '@/lib/platform/razorpay-webhook'
import { sha256Hex } from '@/lib/crypto'

// POST /api/webhooks/razorpay
// 1. verify X-Razorpay-Signature over the RAW body
// 2. dedupe on X-Razorpay-Event-Id
// 3. process; return 200 quickly so Razorpay does not retry needlessly
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const raw = await request.text()
  if (!verifyRazorpaySignature(raw, request.headers.get('x-razorpay-signature'), razorpayWebhookSecret())) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Invalid signature' } }, { status: 401 })
  }
  let body: RazorpayWebhook
  try {
    body = JSON.parse(raw) as RazorpayWebhook
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  const eventId = request.headers.get('x-razorpay-event-id') ?? `sha256:${sha256Hex(raw)}`
  try {
    const outcome = await processRazorpayEvent(prisma, eventId, body)
    return NextResponse.json({ ok: true, outcome })
  } catch (error) {
    console.error('[razorpay-webhook] failed', eventId, error)
    // 500 makes Razorpay retry later; the event row records the error.
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Processing failed' } }, { status: 500 })
  }
}
