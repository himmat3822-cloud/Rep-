import { ok, publicRoute } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { enquirySchema } from '@/lib/validation/growth'
import { prisma } from '@/lib/db/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { toE164 } from '@/lib/phone'
import { hitRateLimit } from '@/lib/rate-limit'
import { notifyStaff } from '@/lib/athlete/notify'
import { getGymFeatures } from '@/lib/gym/features'

// POST /api/g/{slug}/enquire - the public "Join us / free trial" form that
// gyms link from Instagram bio, Google profile or their website. Creates a
// WEBSITE lead. Bots that fill the hidden field get a fake success.
export const POST = publicRoute({ schema: enquirySchema }, async ({ params, input, meta }) => {
  if (input.website) return ok({ ok: true }, { status: 201 })
  const limit = await hitRateLimit(prisma, `enquire:${meta.ip ?? 'unknown'}`, 5, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const phone = toE164(input.phone)
  if (!phone) throw errors.validation('Enter a valid Indian mobile number')
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { id: true, subscriptionStatus: true } })
  if (!gym || !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(gym.subscriptionStatus)) throw errors.notFound('Gym')
  if (!(await getGymFeatures(gym.id)).includes('leads_crm')) throw errors.notFound('Gym')
  const db = scopeToGym(prisma, gym.id)
  const member = await db.athlete.findFirst({ where: { phone, archived: false }, select: { id: true } })
  const open = await db.lead.findFirst({ where: { phone, stage: { notIn: ['JOINED', 'LOST'] } }, select: { id: true, notes: true } })
  // Same answer either way, so the form never reveals who is a member.
  if (!member) {
    const line = [input.interest && `Interest: ${input.interest}`, input.message && `Message: ${input.message}`].filter(Boolean).join('. ')
    if (open) {
      if (line) await db.lead.update({ where: { id: open.id }, data: { notes: `Enquired again: ${line}\n${open.notes}`, nextFollowUpAt: new Date() } })
    } else {
      await db.lead.create({ data: { gymId: gym.id, name: input.name, phone, source: 'WEBSITE', interest: input.interest, notes: line, nextFollowUpAt: new Date() } })
      await notifyStaff(db, gym.id, { title: `New enquiry: ${input.name}`, body: `${input.interest || 'Wants to know more'}. Call ${phone} today.`, href: '/owner/leads?view=today' })
    }
  }
  return ok({ ok: true }, { status: 201 })
})
