import 'server-only'
import { devLogOtp, optionalEnv } from '@/lib/env'
import { toWhatsAppId } from '@/lib/phone'

// Meta WhatsApp Cloud API - template messages only (business-initiated).
// Phase 1 uses it for OTP. Phase 5 adds reminders, quota and status webhooks.

export type WaLanguage = 'EN' | 'HI' | 'PA'

const WA_LANGUAGE_CODE: Record<WaLanguage, string> = { EN: 'en', HI: 'hi', PA: 'pa' }

export interface TemplateMessage {
  to: string
  template: string
  language: WaLanguage
  bodyParams?: string[]
  // Authentication templates with a copy-code button need the code again here.
  urlButtonParam?: string
}

export interface SendResult {
  providerId: string | null
  skipped: boolean
}

export function whatsappConfigured(): boolean {
  return Boolean(optionalEnv('WHATSAPP_TOKEN') && optionalEnv('WHATSAPP_PHONE_NUMBER_ID'))
}

export async function sendWhatsAppTemplate(message: TemplateMessage): Promise<SendResult> {
  const token = optionalEnv('WHATSAPP_TOKEN')
  const phoneNumberId = optionalEnv('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId) {
    if (devLogOtp()) {
      console.info(`[whatsapp:dev] to=${message.to} template=${message.template} lang=${message.language} params=${JSON.stringify(message.bodyParams ?? [])}`)
      return { providerId: null, skipped: true }
    }
    throw new Error('WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)')
  }

  const components: Record<string, unknown>[] = []
  if (message.bodyParams?.length) {
    components.push({ type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) })
  }
  if (message.urlButtonParam) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: message.urlButtonParam }] })
  }

  const version = optionalEnv('WHATSAPP_API_VERSION') ?? 'v21.0'
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWhatsAppId(message.to),
      type: 'template',
      template: {
        name: message.template,
        language: { code: WA_LANGUAGE_CODE[message.language] },
        components,
      },
    }),
  })

  const data = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } }
  if (!response.ok) {
    throw new Error(`WhatsApp send failed: ${data.error?.message ?? response.statusText}`)
  }
  return { providerId: data.messages?.[0]?.id ?? null, skipped: false }
}
