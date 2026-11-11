import 'server-only'
import { prisma } from '@/lib/db/client'
import { scopeToGym } from '@/lib/db/tenant-core'

// Public referral landing page data: the gym and the referrer's first name.
export async function loadInvite(slug: string, ref: string | undefined) {
  if (!ref || !/^[A-Za-z0-9]{3,30}$/.test(ref)) return null
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true, city: true, subscriptionStatus: true } })
  if (!gym || !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(gym.subscriptionStatus)) return null
  const referrer = await scopeToGym(prisma, gym.id).athlete.findFirst({ where: { referralCode: ref.toUpperCase(), archived: false }, select: { name: true, language: true, referralCode: true } })
  if (!referrer) return null
  return { gymName: gym.name, city: gym.city, friend: referrer.name.split(/\s+/)[0], language: referrer.language, code: referrer.referralCode }
}
