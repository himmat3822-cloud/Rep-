import { ok, publicRoute } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { joinSchema } from '@/lib/validation/athlete'
import { prisma } from '@/lib/db/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { toE164 } from '@/lib/phone'
import { hitRateLimit } from '@/lib/rate-limit'
import { notifyStaff } from '@/lib/athlete/notify'

// POST /api/g/{slug}/join { name, phone, ref } - public "refer a friend" form.
// Creates a REFERRAL lead for the gym to call. The reward is given later,
// when the friend joins (desk enters the referral code) and pays.
export const POST = publicRoute({ schema: joinSchema }, async ({ params, input, meta }) => {
  const limit = await hitRateLimit(prisma, `join:${meta.ip ?? 'unknown'}`, 5, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const phone = toE164(input.phone)
  if (!phone) throw errors.validation('Enter a valid Indian mobile number')
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { id: true, subscriptionStatus: true } })
  if (!gym || !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(gym.subscriptionStatus)) throw errors.notFound('Gym')
  const db = scopeToGym(prisma, gym.id)
  const referrer = await db.athlete.findFirst({ where: { referralCode: input.ref.toUpperCase(), archived: false }, select: { id: true, name: true, referralCode: true } })
  if (!referrer) throw errors.notFound('Invite')
  const member = await db.athlete.findFirst({ where: { phone }, select: { id: true } })
  const existing = await db.lead.findFirst({ where: { phone, stage: { notIn: ['JOINED', 'LOST'] } } })
  if (!member && !existing) {
    await db.lead.create({
      data: { gymId: gym.id, name: input.name, phone, source: 'REFERRAL', referrerId: referrer.id, interest: 'Free trial', notes: `Referred by ${referrer.name} (code ${referrer.referralCode})`, nextFollowUpAt: new Date(Date.now() + 86400000) },
    })
    await notifyStaff(db, gym.id, { title: `New referral: ${input.name}`, body: `${referrer.name} invited them. Call ${phone} for a free trial. Referral code ${referrer.referralCode}.`, href: '/owner' })
  }
  return ok({ ok: true, code: referrer.referralCode }, { status: 201 })
})
