import type { PrismaClient } from '@/lib/generated/prisma/client'
import { appUrl } from '@/lib/env'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/integrations/brevo'
import { sendWhatsAppTemplate, whatsappConfigured } from '@/lib/integrations/whatsapp'

// Platform -> gym owner messages (billing reminders, admin announcements).
// Always writes an in-app notification; email and WhatsApp are best-effort
// and never throw into the caller. These are Rep+'s own messages, so they
// do not count against the gym's WhatsApp quota.

export interface OwnerMessage {
  title: string
  body: string
  href?: string
  email?: boolean
  whatsappTemplate?: string
  whatsappParams?: string[] | ((owner: { name: string }) => string[])
}

export interface NotifyResult {
  recipients: number
  emails: number
  whatsapp: number
}

export async function notifyGymOwners(db: PrismaClient, gymId: string, message: OwnerMessage): Promise<NotifyResult> {
  const owners = await db.gymUser.findMany({ where: { gymId, kind: 'OWNER', active: true }, select: { id: true, name: true, email: true, phone: true, language: true } })
  const result: NotifyResult = { recipients: owners.length, emails: 0, whatsapp: 0 }
  if (owners.length === 0) return result

  await db.notification.createMany({
    data: owners.map((owner) => ({ gymId, recipientType: 'STAFF' as const, recipientId: owner.id, title: message.title, body: message.body, href: message.href ?? null })),
  })

  for (const owner of owners) {
    if (message.email && owner.email) {
      try {
        const link = message.href ? `<p><a href="${appUrl()}${message.href}" style="color:#6c8d29;font-weight:700">Open Rep+</a></p>` : ''
        await sendEmail({
          to: [{ email: owner.email, name: owner.name }],
          subject: message.title,
          html: emailLayout(message.title, `<p>Hi ${escapeHtml(owner.name.split(' ')[0])},</p><p>${escapeHtml(message.body)}</p>${link}`),
          tags: ['platform'],
        })
        result.emails += 1
      } catch (error) {
        console.error('[notify] email failed', gymId, error)
      }
    }
    if (message.whatsappTemplate && whatsappConfigured()) {
      try {
        await sendWhatsAppTemplate({ to: owner.phone, template: message.whatsappTemplate, language: owner.language, bodyParams: typeof message.whatsappParams === 'function' ? message.whatsappParams(owner) : (message.whatsappParams ?? [owner.name.split(' ')[0], message.body]) })
        result.whatsapp += 1
      } catch (error) {
        console.error('[notify] whatsapp failed', gymId, error)
      }
    }
  }
  return result
}
