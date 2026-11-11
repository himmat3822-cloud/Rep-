import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EyeOff, Flame, Lock } from 'lucide-react'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { DeleteButton, NoteForm, NudgeButton, PtLogForm, ReleasePlanButton, StaffSplitEditor, type StaffSplitDay } from '@/components/trainer/actions'
import { Heatmap, WeightChart } from '@/components/athlete/progress'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { rosterWhere, ptStatus } from '@/lib/trainer/service'
import { attendanceHeatmap, monthSummary } from '@/lib/athlete/progress'
import { privateImageUrl } from '@/lib/integrations/cloudinary'
import { daysBetween, formatIstDate, istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'Member - Trainer desk - Rep+' }

const TABS = [
  ['overview', 'Overview'],
  ['plan', 'Workout and diet'],
  ['notes', 'Notes'],
  ['pt', 'PT sessions'],
  ['progress', 'Progress'],
] as const
type Tab = (typeof TABS)[number][0]

const day = (d: Date) => formatIstDate(d, { day: 'numeric', month: 'short' })
const stamp = (d: Date) => formatIstDate(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default async function TrainerAthletePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const requested = (await searchParams).tab
  const tab: Tab = TABS.some(([key]) => key === requested) ? (requested as Tab) : 'overview'
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  const db = tenantDb(gym.id)
  const staff = { sub: user.id, kind: user.kind, name: user.name }
  // Trainers only see their own roster; no money fields are loaded here.
  const athlete = await db.athlete.findFirst({
    where: { id, ...rosterWhere(staff) },
    select: { id: true, name: true, memberCode: true, status: true, gender: true, dateOfBirth: true, joinedAt: true, lastVisitAt: true, streakDays: true, bestStreak: true, restDays: true, shareProgressWithTrainer: true, sharePhotosWithTrainer: true },
  })
  if (!athlete) notFound()
  const features = await getGymFeatures(gym.id)
  const today = istDateOnly()
  const membership = await db.membership.findFirst({ where: { athleteId: id, status: { in: ['ACTIVE', 'FROZEN', 'PENDING'] }, endsAt: { gte: today } }, orderBy: { endsAt: 'desc' }, select: { endsAt: true, status: true, planId: true } })
  const plan = membership ? await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { name: true } }) : null
  const age = athlete.dateOfBirth ? Math.floor(daysBetween(athlete.dateOfBirth, today) / 365.25) : null

  return (
    <TrainerShell gym={gym} user={user} title={athlete.name}>
      <div className="member-head panel" style={{ marginBottom: 14 }}>
        <div className="row-between">
          <div>
            <p className="kicker">{athlete.memberCode}{age ? ` - ${age} yrs` : ''}{athlete.gender ? ` - ${athlete.gender}` : ''}</p>
            <h2 style={{ margin: 0 }}>{athlete.name}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {plan ? `${plan.name}, ends ${day(membership!.endsAt)}${membership!.status === 'FROZEN' ? ' (frozen)' : ''}` : 'No running plan'} - <Flame className="inline-icon" /> {athlete.streakDays}-day streak
            </p>
          </div>
          <div className="row-actions">
            <StatusBadge value={athlete.status} />
            <NudgeButton athleteId={athlete.id} name={athlete.name} />
          </div>
        </div>
      </div>
      <div className="tab-links">
        {TABS.map(([key, label]) => (
          <Link key={key} className={tab === key ? 'active' : ''} href={`/trainer/athletes/${id}${key === 'overview' ? '' : `?tab=${key}`}`}>
            {label}
          </Link>
        ))}
      </div>
      {tab === 'overview' ? await Overview() : null}
      {tab === 'plan' ? await Plan() : null}
      {tab === 'notes' ? await Notes() : null}
      {tab === 'pt' ? await Pt() : null}
      {tab === 'progress' ? await Progress() : null}
    </TrainerShell>
  )

  async function Overview() {
    const [cells, summary, visits] = await Promise.all([
      attendanceHeatmap(db, id),
      monthSummary(db, id),
      db.checkIn.findMany({ where: { athleteId: id }, orderBy: { checkedInAt: 'desc' }, take: 8, select: { checkedInAt: true, checkedOutAt: true, method: true } }),
    ])
    return (
      <div className="two-col">
        <section className="panel">
          <p className="kicker">ATTENDANCE - LAST 6 MONTHS</p>
          <Heatmap cells={cells} />
          <div className="sum-strip" style={{ marginTop: 14 }}>
            <div>This month<strong>{summary.visits}</strong></div>
            <div>Best run this month<strong>{summary.bestStreak}d</strong></div>
            <div>Best streak ever<strong>{athlete!.bestStreak}d</strong></div>
            <div>Last visit<strong>{athlete!.lastVisitAt ? day(athlete!.lastVisitAt) : '-'}</strong></div>
          </div>
        </section>
        <section className="panel">
          <p className="kicker">RECENT VISITS</p>
          <ul className="t-list">
            {visits.map((v, i) => (
              <li key={i}>
                <span className="grow">{stamp(v.checkedInAt)}</span>
                <small>{v.checkedOutAt ? `${Math.round((v.checkedOutAt.getTime() - v.checkedInAt.getTime()) / 60000)} min` : ''} {v.method.toLowerCase().replace('_', ' ')}</small>
              </li>
            ))}
            {visits.length === 0 ? <li className="muted">No visits yet.</li> : null}
          </ul>
        </section>
      </div>
    )
  }

  async function Plan() {
    if (!features.includes('workout_diet_plans')) return <div className="table-empty">Workout and diet plans are not in this gym&apos;s Rep+ plan.</div>
    const [split, templates] = await Promise.all([
      db.workoutSplit.findFirst({ where: { athleteId: id, active: true }, orderBy: { updatedAt: 'desc' } }),
      db.workoutTemplate.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 }),
    ])
    const author = split?.createdById ? await db.gymUser.findFirst({ where: { id: split.createdById }, select: { name: true } }) : null
    const days = ((split?.days as { days?: StaffSplitDay[] } | null)?.days ?? []) as StaffSplitDay[]
    return (
      <section className="panel">
        <div className="row-between">
          <div>
            <p className="kicker">WEEKLY SPLIT</p>
            <h2>{split ? (author ? `Set by ${author.name}` : 'Made by the member') : 'No plan yet'}</h2>
            <p className="muted">Saving replaces the member&apos;s current plan and tells them in the app. Rest days: {athlete!.restDays.length ? athlete!.restDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : 'none set'}.</p>
          </div>
          {split?.createdById ? <ReleasePlanButton athleteId={id} /> : null}
        </div>
        <StaffSplitEditor
          initialDays={days}
          initialDiet={split?.dietNotes ?? ''}
          saveUrl={`/api/gym/trainer/athletes/${id}/split`}
          templates={templates.map((t) => ({ id: t.id, name: t.name, days: ((t.days as { days?: StaffSplitDay[] }).days ?? []) as StaffSplitDay[], dietNotes: t.dietNotes }))}
          saveLabel="Save and send to member"
        />
      </section>
    )
  }

  async function Notes() {
    const notes = await db.trainerNote.findMany({ where: { athleteId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { trainer: { select: { name: true } } } })
    return (
      <section className="panel">
        <p className="kicker">NOTES (THE MEMBER SEES THESE)</p>
        <NoteForm athleteId={id} />
        <ul className="note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <div className="row-between">
                <small>
                  {note.trainer.name} - {stamp(note.createdAt)}
                </small>
                {note.trainerId === user.id || user.kind === 'OWNER' ? <DeleteButton url={`/api/gym/trainer/notes/${note.id}`} label="Delete note" confirm="Delete this note? The member will no longer see it." done="Note deleted" /> : null}
              </div>
              <p>{note.body}</p>
            </li>
          ))}
          {notes.length === 0 ? <li className="muted">No notes yet.</li> : null}
        </ul>
      </section>
    )
  }

  async function Pt() {
    if (!features.includes('pt_tracking')) return <div className="table-empty">PT tracking is not in this gym&apos;s Rep+ plan.</div>
    const sessions = await db.ptSession.findMany({ where: { athleteId: id }, orderBy: { sessionAt: 'desc' }, take: 50, include: { trainer: { select: { name: true } } } })
    return (
      <section className="panel">
        <p className="kicker">LOG A PT SESSION</p>
        <PtLogForm athleteId={id} />
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data-table">
            <thead>
              <tr><th>When</th><th>Trainer</th><th>Minutes</th><th>Notes</th><th>Member</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const status = ptStatus(s)
                return (
                  <tr key={s.id}>
                    <td>{stamp(s.sessionAt)}</td>
                    <td>{s.trainer.name}</td>
                    <td>{s.durationMin}</td>
                    <td>{s.notes || '-'}{s.disputeNote ? <span className="sub">Member: &quot;{s.disputeNote}&quot;</span> : null}</td>
                    <td><StatusBadge value={status === 'signed' ? 'APPROVED' : status === 'disputed' ? 'REJECTED' : 'PENDING'} label={status === 'signed' ? 'Confirmed' : status === 'disputed' ? 'Disputed' : 'Waiting'} /></td>
                    <td>{status === 'pending' && (s.trainerId === user.id || user.kind === 'OWNER') ? <DeleteButton url={`/api/gym/pt-sessions/${s.id}`} label="Delete session" confirm="Delete this session?" done="Session deleted" /> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sessions.length === 0 ? <div className="table-empty">No PT sessions yet.</div> : null}
        </div>
      </section>
    )
  }

  async function Progress() {
    if (!athlete!.shareProgressWithTrainer && !athlete!.sharePhotosWithTrainer) {
      return (
        <div className="table-empty">
          <Lock className="inline-icon" /> {athlete!.name.split(' ')[0]} keeps their progress private. They can share it from Profile &gt; Privacy in their app.
        </div>
      )
    }
    const [logs, records, photos] = await Promise.all([
      athlete!.shareProgressWithTrainer ? db.progressLog.findMany({ where: { athleteId: id }, orderBy: { loggedOn: 'desc' }, take: 30 }) : Promise.resolve([]),
      athlete!.shareProgressWithTrainer ? db.personalRecord.findMany({ where: { athleteId: id }, orderBy: { achievedOn: 'desc' }, take: 30 }) : Promise.resolve([]),
      athlete!.sharePhotosWithTrainer ? db.progressPhoto.findMany({ where: { athleteId: id }, orderBy: { takenOn: 'desc' }, take: 24 }) : Promise.resolve([]),
    ])
    return (
      <>
        {athlete!.shareProgressWithTrainer ? (
          <div className="two-col">
            <section className="panel">
              <p className="kicker">WEIGHT TREND</p>
              <WeightChart points={logs.filter((l) => l.weightKg !== null).reverse().map((l) => ({ date: l.loggedOn.toISOString().slice(0, 10), value: l.weightKg! }))} empty="No weight logged yet." />
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data-table">
                  <thead><tr><th>Date</th><th>kg</th><th>Chest</th><th>Waist</th><th>Arms</th><th>Fat %</th></tr></thead>
                  <tbody>
                    {logs.slice(0, 12).map((l) => (
                      <tr key={l.id}><td>{day(l.loggedOn)}</td><td>{l.weightKg ?? '-'}</td><td>{l.chestCm ?? '-'}</td><td>{l.waistCm ?? '-'}</td><td>{l.armsCm ?? '-'}</td><td>{l.bodyFatPct ?? '-'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <p className="kicker">PERSONAL RECORDS</p>
              <ul className="t-list">
                {records.map((r) => (
                  <li key={r.id}><span className="grow"><strong>{r.exercise}</strong> {r.weightKg} kg x {r.reps}</span><small>{day(r.achievedOn)}</small></li>
                ))}
                {records.length === 0 ? <li className="muted">No records yet.</li> : null}
              </ul>
            </section>
          </div>
        ) : (
          <div className="table-empty"><EyeOff className="inline-icon" /> Weight, measurements and records are private.</div>
        )}
        {athlete!.sharePhotosWithTrainer ? (
          <section className="panel" style={{ marginTop: 14 }}>
            <p className="kicker">PROGRESS PHOTOS (SHARED BY THE MEMBER)</p>
            <div className="photo-grid wide">
              {photos.map((p) => (
                <figure key={p.id} className="photo-tile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={privateImageUrl(p.publicId, 'c_fill,g_auto,w_300,h_400,q_auto,f_auto') ?? ''} alt="" loading="lazy" />
                  <figcaption className="photo-meta"><small>{day(p.takenOn)} - {p.pose}</small></figcaption>
                </figure>
              ))}
              {photos.length === 0 ? <p className="muted">No photos yet.</p> : null}
            </div>
          </section>
        ) : null}
      </>
    )
  }
}
