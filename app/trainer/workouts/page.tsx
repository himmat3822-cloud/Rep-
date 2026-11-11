import type { Metadata } from 'next'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { ApplyTemplate, DeleteButton, type StaffSplitDay } from '@/components/trainer/actions'
import { EditTemplate, NewTemplate } from '@/components/trainer/templates'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { loadRoster } from '@/lib/trainer/roster'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Workout plans - Rep+' }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default async function WorkoutPlansPage() {
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  const db = tenantDb(gym.id)
  const features = await getGymFeatures(gym.id)
  if (!features.includes('workout_diet_plans')) {
    return (
      <TrainerShell gym={gym} user={user} title="Workout plans">
        <div className="table-empty">Workout and diet plans are not in this gym&apos;s Rep+ plan.</div>
      </TrainerShell>
    )
  }
  const [templates, roster, staff] = await Promise.all([
    db.workoutTemplate.findMany({ orderBy: { updatedAt: 'desc' } }),
    loadRoster(db, { sub: user.id, kind: user.kind, name: user.name }),
    db.gymUser.findMany({ select: { id: true, name: true } }),
  ])
  const author = new Map(staff.map((s) => [s.id, s.name]))
  return (
    <TrainerShell gym={gym} user={user} title="Workout plans">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0 }}>Save a split once, give it to many members. Every trainer at {gym.name} can use these plans.</p>
        <NewTemplate />
      </div>
      <div className="template-grid">
        {templates.map((t) => {
          const days = ((t.days as { days?: StaffSplitDay[] }).days ?? []) as StaffSplitDay[]
          const mine = t.createdById === user.id || user.kind === 'OWNER'
          return (
            <section key={t.id} className="panel template-card">
              <div className="row-between">
                <div>
                  <h3>{t.name}</h3>
                  <small className="muted">{t.goal || 'General'} - {days.length} days a week - by {author.get(t.createdById) ?? 'trainer'}, {formatIstDate(t.updatedAt, { day: 'numeric', month: 'short' })}</small>
                </div>
                {mine ? <DeleteButton url={`/api/gym/workout-templates/${t.id}`} label="Delete plan" confirm={`Delete "${t.name}"? Members who already have it keep their copy.`} done="Plan deleted" /> : null}
              </div>
              <ul className="template-days">
                {days.map((d) => (
                  <li key={d.weekday}>
                    <span>{WEEKDAY[d.weekday]}</span>
                    <strong>{d.title}</strong>
                    <small>{d.exercises.length} exercises</small>
                  </li>
                ))}
              </ul>
              {t.dietNotes ? <p className="diet-preview">{t.dietNotes}</p> : null}
              <div className="row-actions">
                <ApplyTemplate templateId={t.id} athletes={roster.map((r) => ({ id: r.id, name: r.name, hasPlan: r.hasPlan }))} />
                {mine ? <EditTemplate id={t.id} name={t.name} goal={t.goal} days={days} dietNotes={t.dietNotes} /> : null}
              </div>
            </section>
          )
        })}
        {templates.length === 0 ? <div className="table-empty">No saved plans yet. Make one with New plan.</div> : null}
      </div>
    </TrainerShell>
  )
}
