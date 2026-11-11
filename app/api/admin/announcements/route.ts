import { adminRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { announcementSchema } from '@/lib/validation/admin'
import { notifyGymOwners } from '@/lib/platform/notify'

// GET /api/admin/announcements
export const GET = adminRoute({}, async () => ok(await prisma.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })))

// POST /api/admin/announcements - in-app to every matching gym owner,
// plus email / WhatsApp when ticked.
export const POST = adminRoute({ schema: announcementSchema }, async ({ input, admin, meta }) => {
  const gyms = await prisma.gym.findMany({
    where: input.audience === 'ALL' ? { subscriptionStatus: { notIn: ['CANCELLED'] } } : { subscriptionStatus: input.audience },
    select: { id: true },
  })
  let recipients = 0
  let emails = 0
  let whatsapp = 0
  for (const gym of gyms) {
    const result = await notifyGymOwners(prisma, gym.id, {
      title: input.title,
      body: input.body,
      email: input.sendEmail,
      whatsappTemplate: input.sendWhatsapp ? 'kasrat_platform_announcement' : undefined,
      whatsappParams: [input.title, input.body.slice(0, 900)],
    })
    recipients += result.recipients
    emails += result.emails
    whatsapp += result.whatsapp
  }
  const announcement = await prisma.platformAnnouncement.create({
    data: { title: input.title, body: input.body, audience: input.audience, sendEmail: input.sendEmail, sendWhatsapp: input.sendWhatsapp, recipients, emailsSent: emails, whatsappSent: whatsapp, createdBy: admin.sub },
  })
  await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'announcement.send', entity: 'PlatformAnnouncement', entityId: announcement.id, meta: { audience: input.audience, gyms: gyms.length, recipients, emails, whatsapp }, ip: meta.ip })
  return ok(announcement, { status: 201 })
})
