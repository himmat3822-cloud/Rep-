import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { ProfileView } from '@/components/athlete/profile'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { appUrl } from '@/lib/env'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Profile - Rep+' }

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const [config, referrals, photoCount] = await Promise.all([
    loadGymConfig(db, gym.id),
    db.referral.findMany({ where: { referrerId: athlete.id }, select: { rewardDays: true, rewardedAt: true } }),
    db.progressPhoto.count({ where: { athleteId: athlete.id } }),
  ])
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <ProfileView
        slug={slug}
        lang={athlete.language}
        gymName={gym.name}
        name={athlete.name}
        memberCode={athlete.memberCode}
        since={formatIstDate(athlete.joinedAt, { month: 'short', year: 'numeric' })}
        referral={{
          code: athlete.referralCode,
          link: `${appUrl()}/g/${slug}/join?ref=${athlete.referralCode}`,
          rewardDays: config.settings.referralRewardDays,
          joined: referrals.length,
          earnedDays: referrals.filter((r) => r.rewardedAt).reduce((sum, r) => sum + r.rewardDays, 0),
        }}
        privacy={{
          shareProgressWithTrainer: athlete.shareProgressWithTrainer,
          sharePhotosWithTrainer: athlete.sharePhotosWithTrainer,
          shareHealthWithTrainer: athlete.shareHealthWithTrainer,
          hideFromLeaderboard: athlete.hideFromLeaderboard,
        }}
        photoCount={photoCount}
      />
    </AthleteChrome>
  )
}
