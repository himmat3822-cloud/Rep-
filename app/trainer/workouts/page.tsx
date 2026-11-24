import type { Metadata } from 'next'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { ApplyTemplate, DeleteButton, type StaffSplitDay } from '@/components/trainer/actions'
import { AddReadyPlan, EditTemplate, NewTemplate } from '@/components/trainer/templates'
import { READY_PLANS } from '@/lib/trainer/ready-plans'
import { parseMeals, type DietMeal } from '@/lib/trainer/diet'
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
  const added = new Set(templates.map((t) => t.name.trim().toLowerCase()))
  const ready = READY_PLANS.filter((plan) => !added.has(plan.name.toLowerCase()))
  return (
    <TrainerShell gym={gym} user={user} title="Workout plans">
      <section className="panel plan-guide">
        <p className="kicker">HOW TO GIVE A MEMBER A PLAN</p>
        <ol>
          <li>Open the member (My members, or the member&apos;s query) and go to the <strong>Plan</strong> tab.</li>
          <li>Pick a plan in <strong>Start from a plan</strong>: one of your gym&apos;s plans or a Rep+ ready plan.</li>
          <li>Change days, exercises and diet notes for that member (veg or non-veg, injuries, timings).</li>
          <li>Tap <strong>Save and send to member</strong>. It shows in their app under Schedule, and they get a notification.</li>
          <li>Reply to their query in one line, for example: &quot;Done, check Schedule. We review in 2 weeks.&quot;</li>
        </ol>
      </section>
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
              <DietPreview meals={parseMeals(t.dietMeals)} notes={t.dietNotes} />
              <div className="row-actions">
                <ApplyTemplate templateId={t.id} athletes={roster.map((r) => ({ id: r.id, name: r.name, hasPlan: r.hasPlan }))} />
                {mine ? <EditTemplate id={t.id} name={t.name} goal={t.goal} days={days} dietNotes={t.dietNotes} dietMeals={parseMeals(t.dietMeals)} /> : null}
              </div>
            </section>
          )
        })}
        {templates.length === 0 ? <div className="table-empty">No saved plans yet. Make one with New plan, or add a ready plan below.</div> : null}
      </div>
      {ready.length ? (
        <>
          <div className="row-between" style={{ margin: '22px 0 10px' }}>
            <div>
              <p className="kicker">REP+ READY PLANS</p>
              <p className="muted" style={{ margin: 0 }}>Tested starting points with simple Indian diet notes. Add one to your gym&apos;s plans, then edit it or give it to many members.</p>
            </div>
          </div>
          <div className="template-grid">
            {ready.map((plan) => (
              <section key={plan.key} className="panel template-card">
                <div>
                  <h3>{plan.name}</h3>
                  <small className="muted">
                    {plan.level} - {plan.days.length} days a week - {plan.goal}
                  </small>
                  <p className="muted" style={{ margin: '6px 0 0' }}>{plan.forWho}</p>
                </div>
                <ul className="template-days">
                  {plan.days.map((day) => (
                    <li key={day.weekday}>
                      <span>{WEEKDAY[day.weekday]}</span>
                      <strong>{day.title}</strong>
                      <small>{day.exercises.length} exercises</small>
                    </li>
                  ))}
                </ul>
                <DietPreview meals={plan.dietMeals} notes={plan.dietNotes} />
                <div className="row-actions">
                  <AddReadyPlan planKey={plan.key} />
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </TrainerShell>
  )
}

function DietPreview({ meals, notes }: { meals: DietMeal[]; notes: string }) {
  if (!meals.length && !notes) return null
  return (
    <div className="diet-preview">
      {meals.map((meal, index) => (
        <p key={index}>
          <strong>
            {meal.name}
            {meal.time ? ` (${meal.time})` : ''}:
          </strong>{' '}
          {meal.items}
        </p>
      ))}
      {notes ? <p>{notes}</p> : null}
    </div>
  )
}
