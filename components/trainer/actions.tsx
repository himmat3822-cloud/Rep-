'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BellRing, Check, ClipboardList, Loader2, Plus, Save, Send, Trash2, Undo2, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'
import { ptLogSchema, type PtLogInput, type PtLogOutput } from '@/lib/validation/trainer'

// Client pieces of the trainer desk. Labels are English like the rest of
// the staff dashboards; what the member receives is in their language.

function fail(error: unknown, fallback: string) {
  toast.error(error instanceof ApiClientError ? error.message : fallback)
}

// --- Nudge -----------------------------------------------------------------
const NUDGES = [
  { kind: 'missed', label: 'Missed you', hint: 'We have not seen you for N days...' },
  { kind: 'comeback', label: 'Come back', hint: 'One session this week gets you back on track' },
  { kind: 'streak', label: 'Great streak', hint: 'Great work on your N-day streak!' },
  { kind: 'plan', label: 'New plan ready', hint: 'Your new workout plan is in the app' },
  { kind: 'pt', label: 'PT coming up', hint: 'Your PT session is coming up' },
] as const

export function NudgeButton({ athleteId, name, compact }: { athleteId: string; name: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const { run, pending } = useAction()

  async function send(kind: string, text?: string) {
    const ok = await run(() => api(`/api/gym/trainer/athletes/${athleteId}/nudge`, { method: 'POST', body: { kind, text } }), `Nudge sent to ${name.split(' ')[0]}`)
    if (ok !== null) setOpen(false)
  }

  return (
    <div className="nudge-wrap">
      <button type="button" className={`btn btn-outline ${compact ? 'btn-sm' : ''}`} onClick={() => setOpen((v) => !v)}>
        <BellRing /> Nudge
      </button>
      {open ? (
        <div className="nudge-pop" role="dialog" aria-label={`Nudge ${name}`}>
          <p className="kicker">SEND IN THEIR LANGUAGE (PUSH FIRST, THEN WHATSAPP)</p>
          {NUDGES.map((nudge) => (
            <button key={nudge.kind} type="button" className="nudge-option" disabled={pending} onClick={() => send(nudge.kind)}>
              <strong>{nudge.label}</strong>
              <small>{nudge.hint}</small>
            </button>
          ))}
          <div className="nudge-custom">
            <input value={custom} maxLength={160} placeholder="Or write your own line" onChange={(e) => setCustom(e.target.value)} />
            <button type="button" className="btn btn-dark btn-sm" disabled={pending || custom.trim().length < 3} onClick={() => send('custom', custom)}>
              {pending ? <Loader2 className="spin" /> : <Send />}
            </button>
          </div>
          <small className="hint">One nudge per member per day. Never between 9 PM and 8 AM.</small>
        </div>
      ) : null}
    </div>
  )
}

// --- Notes -----------------------------------------------------------------
export function NoteForm({ athleteId }: { athleteId: string }) {
  const [body, setBody] = useState('')
  const { run, pending } = useAction()
  return (
    <form
      className="note-form"
      onSubmit={async (event) => {
        event.preventDefault()
        const ok = await run(() => api(`/api/gym/trainer/athletes/${athleteId}/notes`, { method: 'POST', body: { body } }), 'Note sent to the member app')
        if (ok !== null) setBody('')
      }}
    >
      <textarea value={body} rows={3} maxLength={1000} placeholder="Form tip, what to focus on this week, a well done... The member sees this in their app." onChange={(e) => setBody(e.target.value)} />
      <button className="btn btn-dark btn-sm" disabled={pending || body.trim().length < 2}>
        {pending ? <Loader2 className="spin" /> : <Send />} Send note
      </button>
    </form>
  )
}

export function DeleteButton({ url, label, confirm, done }: { url: string; label: string; confirm?: string; done: string }) {
  const { run, pending } = useAction()
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return
        run(() => api(url, { method: 'DELETE' }), done)
      }}
    >
      <Trash2 />
    </button>
  )
}

// --- PT log ----------------------------------------------------------------
function nowLocalInput() {
  const d = new Date(Date.now() + 5.5 * 3600000)
  return d.toISOString().slice(0, 16)
}

export function PtLogForm({ athletes, athleteId }: { athletes?: { id: string; name: string }[]; athleteId?: string }) {
  const router = useRouter()
  const form = useForm<PtLogInput, unknown, PtLogOutput>({ resolver: zodResolver(ptLogSchema), defaultValues: { athleteId: athleteId ?? '', sessionAt: nowLocalInput(), durationMin: 60, notes: '' } })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async (values) => {
    try {
      // The input is IST wall time; send it as an IST timestamp.
      const at = new Date(`${String(form.getValues('sessionAt'))}:00+05:30`)
      await api('/api/gym/pt-sessions', { method: 'POST', body: { ...values, sessionAt: at.toISOString() } })
      toast.success('Session logged. The member confirms it in their app.')
      form.reset({ athleteId: athleteId ?? '', sessionAt: nowLocalInput(), durationMin: 60, notes: '' })
      router.refresh()
    } catch (error) {
      fail(error, 'Could not log the session')
    }
  })
  return (
    <form className="pt-form" onSubmit={submit} noValidate>
      {athletes ? (
        <div className="field">
          <label>Member</label>
          <select {...form.register('athleteId')}>
            <option value="">Pick a member</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {errors.athleteId ? <span className="field-error">Pick a member</span> : null}
        </div>
      ) : null}
      <div className="field">
        <label>When (IST)</label>
        <input type="datetime-local" {...form.register('sessionAt')} />
      </div>
      <div className="field">
        <label>Minutes</label>
        <select {...form.register('durationMin')}>
          {[30, 45, 60, 75, 90].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </div>
      <div className="field wide">
        <label>What you did (optional)</label>
        <input maxLength={500} placeholder="Legs: squats 4x8 at 80 kg, lunges, core finisher" {...form.register('notes')} />
      </div>
      <button className="btn btn-dark" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="spin" /> : <ClipboardList />} Log session
      </button>
    </form>
  )
}

// --- Split editor (staff) ----------------------------------------------------
export interface StaffSplitDay {
  weekday: number
  title: string
  focus: string
  minutes: number
  exercises: { name: string; sets: number; reps: string }[]
}

const WEEK = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [0, 'Sunday'],
] as const

export function StaffSplitEditor({
  initialDays,
  initialDiet,
  saveUrl,
  method = 'PUT',
  extra,
  templates,
  onSaved,
  saveLabel = 'Save plan',
}: {
  initialDays: StaffSplitDay[]
  initialDiet: string
  saveUrl: string
  method?: 'PUT' | 'POST'
  extra?: { name: string; goal: string } | null
  templates?: { id: string; name: string; days: StaffSplitDay[]; dietNotes: string }[]
  onSaved?: () => void
  saveLabel?: string
}) {
  const router = useRouter()
  const [days, setDays] = useState<StaffSplitDay[]>(initialDays)
  const [diet, setDiet] = useState(initialDiet)
  const [meta, setMeta] = useState(extra ?? null)
  const [saving, setSaving] = useState(false)
  const byDay = useMemo(() => new Map(days.map((d) => [d.weekday, d])), [days])

  function toggle(weekday: number) {
    setDays((list) => (list.some((d) => d.weekday === weekday) ? list.filter((d) => d.weekday !== weekday) : [...list, { weekday, title: '', focus: '', minutes: 60, exercises: [{ name: '', sets: 3, reps: '10' }] }]))
  }
  function update(weekday: number, patch: Partial<StaffSplitDay>) {
    setDays((list) => list.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)))
  }
  function loadTemplate(id: string) {
    const template = templates?.find((t) => t.id === id)
    if (!template) return
    setDays(template.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })))
    setDiet(template.dietNotes)
    toast.message(`Loaded "${template.name}". Adjust it, then save.`)
  }

  async function save() {
    setSaving(true)
    try {
      const clean = days.map((d) => ({ ...d, title: d.title.trim() || 'Workout', exercises: d.exercises.filter((e) => e.name.trim()) }))
      await api(saveUrl, { method, body: { ...(meta ?? {}), days: clean, dietNotes: diet } })
      toast.success('Saved')
      onSaved?.()
      router.refresh()
    } catch (error) {
      fail(error, 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="staff-split">
      {meta ? (
        <div className="form-grid">
          <div className="field">
            <label>Plan name</label>
            <input value={meta.name} maxLength={60} placeholder="Beginner fat-loss 4-day" onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Goal</label>
            <input value={meta.goal} maxLength={80} placeholder="Strength, muscle gain, endurance..." onChange={(e) => setMeta({ ...meta, goal: e.target.value })} />
          </div>
        </div>
      ) : null}
      {templates && templates.length ? (
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Start from a saved plan</label>
          <select defaultValue="" onChange={(e) => loadTemplate(e.target.value)}>
            <option value="">Pick a plan...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="split-week">
        {WEEK.map(([wd, label]) => {
          const day = byDay.get(wd)
          return (
            <div key={wd} className={`split-day ${day ? 'on' : ''}`}>
              <label className="split-day-head">
                <input type="checkbox" checked={Boolean(day)} onChange={() => toggle(wd)} />
                <strong>{label}</strong>
                {!day ? <small>Rest day</small> : null}
              </label>
              {day ? (
                <div className="split-day-body">
                  <div className="split-row">
                    <input placeholder="Workout (Push, Legs...)" value={day.title} maxLength={40} onChange={(e) => update(wd, { title: e.target.value })} />
                    <input placeholder="Focus (chest, triceps)" value={day.focus} maxLength={60} onChange={(e) => update(wd, { focus: e.target.value })} />
                    <input type="number" min={5} max={240} title="Minutes" value={day.minutes} onChange={(e) => update(wd, { minutes: Number(e.target.value) || 60 })} />
                  </div>
                  {day.exercises.map((exercise, index) => (
                    <div key={index} className="split-ex">
                      <input placeholder="Exercise" value={exercise.name} maxLength={60} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })} />
                      <input type="number" min={1} max={20} title="Sets" value={exercise.sets} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, sets: Number(e.target.value) || 1 } : x)) })} />
                      <input title="Reps" value={exercise.reps} maxLength={20} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, reps: e.target.value } : x)) })} />
                      <button type="button" className="icon-btn" aria-label="Remove exercise" onClick={() => update(wd, { exercises: day.exercises.filter((_, i) => i !== index) })}>
                        <X />
                      </button>
                    </div>
                  ))}
                  {day.exercises.length < 15 ? (
                    <button type="button" className="link-like" onClick={() => update(wd, { exercises: [...day.exercises, { name: '', sets: 3, reps: '10' }] })}>
                      <Plus /> Add exercise
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="field">
        <label>Diet notes (the member sees these under their workout)</label>
        <textarea rows={4} maxLength={2000} value={diet} placeholder="Protein with every meal (dal, paneer, eggs, curd). 3 litres of water. Light dinner before 9 PM." onChange={(e) => setDiet(e.target.value)} />
      </div>
      <button type="button" className="btn btn-dark" disabled={saving} onClick={save}>
        {saving ? <Loader2 className="spin" /> : <Save />} {saveLabel}
      </button>
    </div>
  )
}

export function ReleasePlanButton({ athleteId }: { athleteId: string }) {
  const { run, pending } = useAction()
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={pending}
      onClick={() => window.confirm('Hand the plan back? The member can then build their own split.') && run(() => api(`/api/gym/trainer/athletes/${athleteId}/split`, { method: 'DELETE' }), 'Plan handed back to the member')}
    >
      <Undo2 /> Hand back
    </button>
  )
}

// --- Apply a template to many members --------------------------------------
export function ApplyTemplate({ templateId, athletes }: { templateId: string; athletes: { id: string; name: string; hasPlan: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const { run, pending } = useAction()
  if (!open) {
    return (
      <button type="button" className="btn btn-dark btn-sm" onClick={() => setOpen(true)}>
        <UserCheck /> Give to members
      </button>
    )
  }
  return (
    <div className="apply-box">
      <div className="apply-list">
        {athletes.map((a) => (
          <label key={a.id} className="check-row">
            <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked((list) => (list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id]))} />
            {a.name} {a.hasPlan ? <small className="muted">(replaces current plan)</small> : null}
          </label>
        ))}
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          disabled={pending || picked.length === 0}
          onClick={async () => {
            const ok = await run(() => api(`/api/gym/workout-templates/${templateId}/apply`, { method: 'POST', body: { athleteIds: picked } }), `Plan given to ${picked.length} member(s)`)
            if (ok !== null) {
              setOpen(false)
              setPicked([])
            }
          }}
        >
          {pending ? <Loader2 className="spin" /> : <Check />} Apply to {picked.length}
        </button>
      </div>
    </div>
  )
}

// --- Owner: bulk assign members to a trainer ---------------------------------
export function AssignMembers({ trainers, athletes }: { trainers: { id: string; name: string }[]; athletes: { id: string; name: string; memberCode: string; trainerName: string | null }[] }) {
  const [trainerId, setTrainerId] = useState(trainers[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const { run, pending } = useAction()
  const shown = athletes.filter((a) => `${a.name} ${a.memberCode}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 80)
  return (
    <div className="assign-box">
      <div className="filter-row" style={{ margin: 0 }}>
        <input className="search-input" placeholder="Search members" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="">No trainer</option>
        </select>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          disabled={pending || picked.length === 0}
          onClick={async () => {
            const ok = await run(() => api('/api/gym/trainers/assign', { method: 'POST', body: { athleteIds: picked, trainerId: trainerId || null } }), 'Members assigned')
            if (ok !== null) setPicked([])
          }}
        >
          {pending ? <Loader2 className="spin" /> : <UserCheck />} Assign {picked.length || ''}
        </button>
      </div>
      <div className="apply-list tall">
        {shown.map((a) => (
          <label key={a.id} className="check-row">
            <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked((list) => (list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id]))} />
            {a.name} <small className="muted">{a.memberCode} - {a.trainerName ?? 'no trainer'}</small>
          </label>
        ))}
      </div>
    </div>
  )
}
