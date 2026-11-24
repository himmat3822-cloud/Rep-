import Link from 'next/link'
import { Dumbbell, MessageCircleQuestion } from 'lucide-react'
import { QueryReplyBox } from './reply-box'
import { viewDb } from '@/lib/owner/branch-view'
import { openQueryCount, staffQueries, TOPIC_LABEL, type QueryFilter } from '@/lib/queries/service'
import { trainingSettings } from '@/lib/trainer/coaches'
import { formatIstDate } from '@/lib/time'

// Member queries board, shared by the owner (all queries) and trainers
// (their own members). Requests, not complaints: diet, split, plan, PT.

const FILTERS: { key: QueryFilter; label: string }[] = [
  { key: 'open', label: 'Waiting for reply' },
  { key: 'answered', label: 'Replied' },
  { key: 'closed', label: 'Done' },
  { key: 'all', label: 'All' },
]

const STATUS_LABEL = { OPEN: 'Waiting', ANSWERED: 'Replied', CLOSED: 'Done' } as const

export async function QueriesScreen({ gymId, viewer, base, filter, memberHref }: { gymId: string; viewer: { id: string; kind: 'OWNER' | 'DESK' | 'TRAINER' }; base: string; filter?: string; memberHref: (id: string) => string }) {
  const active: QueryFilter = FILTERS.some((f) => f.key === filter) ? (filter as QueryFilter) : 'open'
  const db = await viewDb(gymId, viewer.kind === 'OWNER')
  const [threads, openCount, training, staff] = await Promise.all([staffQueries(db, viewer, active), openQueryCount(db, viewer), trainingSettings(db), db.gymUser.findMany({ select: { id: true, name: true } })])
  const staffName = new Map(staff.map((person) => [person.id, person.name]))
  // Owner: always. Trainers: their own members, or anyone when the owner
  // lets any trainer change plans.
  // Trainers open only members whose page they may see.
  const canOpen = (trainerId: string | null) => viewer.kind !== 'TRAINER' || canEditPlan(trainerId)
  const canEditPlan = (trainerId: string | null) => viewer.kind === 'OWNER' || (viewer.kind === 'TRAINER' && (trainerId === viewer.id || training.planEditors === 'any'))
  const when = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="tab-links" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} className={f.key === active ? 'active' : ''} href={`${base}?filter=${f.key}`}>
            {f.label}
            {f.key === 'open' && openCount ? <span className="tab-count">{openCount}</span> : null}
          </Link>
        ))}
      </div>
      {threads.length === 0 ? (
        <section className="panel empty-panel">
          <h2>{active === 'open' ? 'No one is waiting' : 'Nothing here yet'}</h2>
          <p>Members ask for a diet plan, a new split, a plan change or PT from &quot;Ask your trainer&quot; in their app. Each request shows up here, separate from complaints.</p>
        </section>
      ) : (
        <ul className="query-board">
          {threads.map((thread) => (
            <li key={thread.id} className={`panel q-card ${thread.status.toLowerCase()}`}>
              <div className="row-between">
                <div>
                  <span className="tag">{TOPIC_LABEL[thread.topic]}</span>{' '}
                  {canOpen(thread.athlete.trainerId) ? (
                    <Link href={memberHref(thread.athlete.id)} className="q-member">
                      {thread.athlete.name}
                    </Link>
                  ) : (
                    <span className="q-member">{thread.athlete.name}</span>
                  )}
                  <small className="sub">
                    {thread.trainer ? (thread.trainer.id === viewer.id ? 'Sent to you' : `Sent to ${thread.trainer.name}`) : 'Sent to any trainer'} - 
                    {when(thread.lastMessageAt)}
                  </small>
                </div>
                <span className={`q-status ${thread.status.toLowerCase()}`}>{STATUS_LABEL[thread.status]}</span>
              </div>
              <ol className="q-messages">
                {thread.messages.map((message) => (
                  <li key={message.id} className={message.author === 'STAFF' ? 'mine' : 'theirs'}>
                    <span className="q-who">{message.author === 'STAFF' ? (message.staffName ?? 'Staff') : thread.athlete.name.split(' ')[0]}</span>
                    <p>{message.body}</p>
                    <time>{when(message.createdAt)}</time>
                  </li>
                ))}
              </ol>
              <div className="q-tools">
                {(thread.topic === 'DIET' || thread.topic === 'WORKOUT') && canEditPlan(thread.athlete.trainerId) ? (
                  <Link href={`/trainer/athletes/${thread.athlete.id}?tab=plan`} className="button-link outline small-button">
                    <Dumbbell /> {thread.topic === 'DIET' ? 'Update diet plan' : 'Update workout split'}
                  </Link>
                ) : null}
                {(thread.topic === 'DIET' || thread.topic === 'WORKOUT') && viewer.kind === 'TRAINER' && !canEditPlan(thread.athlete.trainerId) ? (
                  <small className="muted">Only {thread.athlete.trainerId ? (staffName.get(thread.athlete.trainerId) ?? 'their trainer') : 'the owner'} can change this member&apos;s plan. You can still reply.</small>
                ) : null}
                {canOpen(thread.athlete.trainerId) ? (
                  <Link href={memberHref(thread.athlete.id)} className="button-link outline small-button">
                    <MessageCircleQuestion /> Open member
                  </Link>
                ) : null}
              </div>
              <QueryReplyBox id={thread.id} closed={thread.status === 'CLOSED'} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
