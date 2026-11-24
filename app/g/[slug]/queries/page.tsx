import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { MemberQueries } from '@/components/athlete/queries'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { markMemberSeen, memberQueries } from '@/lib/queries/service'
import { coachList, trainingSettings } from '@/lib/trainer/coaches'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Ask your trainer - Rep+' }

export default async function MemberQueriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const settings = await trainingSettings(db)
  const [threads, coaches] = await Promise.all([memberQueries(db, athlete.id), coachList(db, settings.ownerTrains)])
  await markMemberSeen(db, athlete.id)
  const when = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <MemberQueries
        slug={slug}
        lang={athlete.language}
        allSee={settings.queryRouting === 'all'}
        coaches={[...coaches].sort((a, b) => Number(b.id === athlete.trainerId) - Number(a.id === athlete.trainerId)).map((coach) => ({ id: coach.id, name: coach.name, mine: coach.id === athlete.trainerId, owner: coach.kind === 'OWNER' }))}
        threads={threads.map((thread) => ({
          id: thread.id,
          topic: thread.topic,
          sentTo: thread.trainer?.name ?? null,
          status: thread.status,
          unread: thread.unreadForMember,
          when: when(thread.lastMessageAt),
          messages: thread.messages.map((message) => ({ id: message.id, mine: message.author === 'ATHLETE', who: message.staffName ?? 'Trainer', body: message.body, when: when(message.createdAt) })),
        }))}
      />
    </AthleteChrome>
  )
}
