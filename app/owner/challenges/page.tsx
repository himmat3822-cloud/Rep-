import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { FeatureLocked } from '@/components/growth/locked'
import { ChallengeForm, DeleteChallenge } from '@/components/growth/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { formatIstDate, istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'Challenges - Rep+' }

export default async function ChallengesPage() {
  const ctx = await requireStaffPage(['OWNER'])
  if (!(await getGymFeatures(ctx.gym.id)).includes('challenges')) {
    return (
      <StaffShell ctx={ctx} title="Challenges">
        <FeatureLocked title="Monthly challenges keep members coming" plan="Pro">
          Run a challenge like 20 visits in November. Members see their progress in the app and finishers get a badge.
        </FeatureLocked>
      </StaffShell>
    )
  }
  const db = tenantDb(ctx.gym.id)
  const today = istDateOnly()
  const challenges = await db.challenge.findMany({ orderBy: { startsAt: 'desc' }, take: 20 })
  const entries = challenges.length ? await db.challengeEntry.findMany({ where: { challengeId: { in: challenges.map((c) => c.id) } }, orderBy: { progress: 'desc' } }) : []
  const athletes = entries.length ? await db.athlete.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.athleteId))] } }, select: { id: true, name: true } }) : []
  const name = new Map(athletes.map((a) => [a.id, a.name]))
  const fmt = (d: Date) => formatIstDate(d, { day: 'numeric', month: 'short' })

  return (
    <StaffShell ctx={ctx} title="Challenges">
      <div className="two-col">
        <section className="panel">
          <p className="kicker">NEW CHALLENGE</p>
          <h2>One challenge at a time</h2>
          <ChallengeForm />
        </section>
        <section className="panel">
          <p className="kicker">CHALLENGES</p>
          {challenges.length === 0 ? <h2>No challenges yet</h2> : null}
          <ul className="challenge-admin">
            {challenges.map((c) => {
              const mine = entries.filter((e) => e.challengeId === c.id)
              const finished = mine.filter((e) => e.completedAt).length
              const state = c.endsAt < today ? 'EXPIRED' : c.startsAt > today ? 'QUEUED' : 'ACTIVE'
              return (
                <li key={c.id}>
                  <div className="row-between">
                    <div>
                      <strong>{c.title}</strong>
                      <small>{fmt(c.startsAt)} - {fmt(c.endsAt)}, target {c.target} {c.metric === 'streak' ? 'day streak' : 'visits'}{c.badgeKey ? ', badge' : ''}</small>
                    </div>
                    <StatusBadge value={state} label={state === 'ACTIVE' ? 'Running' : state === 'QUEUED' ? 'Upcoming' : 'Ended'} />
                  </div>
                  <p className="muted">{mine.length} taking part, {finished} finished</p>
                  {mine.length ? (
                    <ol className="leader-mini">
                      {mine.slice(0, 5).map((e) => (
                        <li key={e.id}>{name.get(e.athleteId) ?? 'Member'} <span>{Math.min(e.progress, c.target)}/{c.target}{e.completedAt ? ' done' : ''}</span></li>
                      ))}
                    </ol>
                  ) : null}
                  {state !== 'EXPIRED' ? <DeleteChallenge id={c.id} /> : null}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </StaffShell>
  )
}
