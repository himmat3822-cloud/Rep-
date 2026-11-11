import { isProduction, optionalEnv } from '@/lib/env'

// Brevo transactional email (https://api.brevo.com/v3/smtp/email).
// Not configured in development -> the email is printed instead.

export interface EmailMessage {
  to: { email: string; name?: string }[]
  subject: string
  html: string
  text?: string
  tags?: string[]
}

export function brevoConfigured(): boolean {
  return Boolean(optionalEnv('BREVO_API_KEY'))
}

export async function sendEmail(message: EmailMessage): Promise<{ messageId: string | null; skipped: boolean }> {
  const apiKey = optionalEnv('BREVO_API_KEY')
  if (!apiKey) {
    if (!isProduction) {
      console.info(`[email:dev] to=${message.to.map((r) => r.email).join(',')} subject="${message.subject}"`)
      return { messageId: null, skipped: true }
    }
    throw new Error('Brevo is not configured (BREVO_API_KEY)')
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: optionalEnv('BREVO_SENDER_EMAIL') ?? 'no-reply@kasrat.app', name: optionalEnv('BREVO_SENDER_NAME') ?? 'Rep+' },
      to: message.to,
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      tags: message.tags,
    }),
  })
  const data = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string }
  if (!response.ok) throw new Error(`Brevo send failed: ${data.message ?? response.statusText}`)
  return { messageId: data.messageId ?? null, skipped: false }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Minimal branded wrapper so every Rep+ email looks the same.
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3f5ee;font-family:Arial,Helvetica,sans-serif;color:#18211e">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<div style="font-size:22px;font-weight:800;letter-spacing:-1px;margin-bottom:18px">REP<span style="color:#9bbd2b">+</span></div>
<div style="background:#fff;border:1px solid #dfe5d8;border-radius:16px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:14px;line-height:1.6;color:#3d4842">${bodyHtml}</div>
</div>
<p style="font-size:11px;color:#77817a;margin-top:16px">You get this because you own a gym on Rep+.</p>
</div></body></html>`
}
