import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { isProduction, optionalEnv } from '@/lib/env'
import { applyWhatsAppWebhook, verifyMetaSignature } from '@/lib/messaging/webhook'

// WhatsApp Cloud API webhook.
// GET  - Meta's one-time verification (hub.verify_token must match WHATSAPP_VERIFY_TOKEN)
// POST - delivery receipts (sent / delivered / read / failed) and STOP / START replies
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge') ?? ''
  const expected = optionalEnv('WHATSAPP_VERIFY_TOKEN')
  if (mode === 'subscribe' && expected && token === expected) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } }, { status: 403 })
}

export async function POST(request: Request) {
  const raw = await request.text()
  const secret = optionalEnv('WHATSAPP_APP_SECRET')
  if (secret) {
    if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Invalid signature' } }, { status: 401 })
    }
  } else if (isProduction) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'WHATSAPP_APP_SECRET is not set' } }, { status: 500 })
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  try {
    const result = await applyWhatsAppWebhook(prisma, payload)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[whatsapp-webhook] failed', error)
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Processing failed' } }, { status: 500 })
  }
}
