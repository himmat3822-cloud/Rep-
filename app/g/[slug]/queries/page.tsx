import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { MemberQueries } from '@/components/athlete/queries'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { markMemberSeen, memberQueries } from '@/lib/queries/service'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Ask your trainer - Rep+' }

export default async function MemberQueriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const [threads, trainer] = await Promise.all([
    memberQueries(db, athlete.id),
    athlete.trainerId ? db.gymUser.findFirst({ where: { id: athlete.trainerId }, select: { name: true } }) : Promise.resolve(null),
  ])
  await markMemberSeen(db, athlete.id)
  const when = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <MemberQueries
        slug={slug}
        lang={athlete.language}
        trainer={trainer?.name ?? null}
        threads={threads.map((thread) => ({
          id: thread.id,
          topic: thread.topic,
          status: thread.status,
          unread: thread.unreadForMember,
          when: when(thread.lastMessageAt),
          messages: thread.messages.map((message) => ({ id: message.id, mine: message.author === 'ATHLETE', who: message.staffName ?? 'Trainer', body: message.body, when: when(message.createdAt) })),
        }))}
      />
    </AthleteChrome>
  )
}
