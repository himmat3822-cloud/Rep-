'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Check, Dumbbell, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'
import type { WorkoutDay } from '@/lib/athlete/home'
import type { SlotView } from '@/lib/athlete/slots'

// Schedule tab: week strip, the day's workout from the split, slot booking
// with live capacity (book / cancel / move), and the split editor.

const LOCALE: Record<Lang, string> = { EN: 'en-IN', HI: 'hi-IN', PA: 'pa-IN' }
const hourLabel = (hour: number) => `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? 'AM' : 'PM'}`

interface Booking {
  id: string
  slotId: string
  date: string
  startHour: number
  branch: string
}

function dayLabel(iso: string, lang: Lang, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE[lang], { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

export function ScheduleView(props: {
  slug: string
  lang: Lang
  days: string[]
  restDays: number[]
  split: WorkoutDay[]
  dietNotes: string | null
  trainerName: string | null
  slotsEnabled: boolean
  branches: { id: string; name: string }[]
  homeBranchId: string
  initialSlots: SlotView[]
  initialBookings: Booking[]
}) {
  const { slug, lang } = props
  const t = translator(lang)
  const router = useRouter()
  const [day, setDay] = useState(props.days[0])
  const [branchId, setBranchId] = useState(props.homeBranchId)
  const [slots, setSlots] = useState<SlotView[]>(props.initialSlots)
  const [bookings, setBookings] = useState<Booking[]>(props.initialBookings)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const workout = props.restDays.includes(weekday) ? null : (props.split.find((d) => d.weekday === weekday) ?? null)
  const bookingThatDay = bookings.find((b) => b.date === day)

  async function load(nextDay: string, nextBranch = branchId) {
    setDay(nextDay)
    if (!props.slotsEnabled) return
    setLoading(true)
    try {
      const data = await api<{ slots: SlotView[] }>(`/api/g/${slug}/slots?date=${nextDay}&branchId=${nextBranch}`, { session: 'athlete' })
      setSlots(data.slots)
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not load slots')
    } finally {
      setLoading(false)
    }
  }

  async function refreshBookings() {
    router.refresh()
  }

  async function book(slot: SlotView) {
    setBusy(slot.id)
    try {
      const result = await api<{ id: string; slotId: string; date: string; startHour: number }>(`/api/g/${slug}/bookings`, {
        method: 'POST',
        body: { slotId: slot.id, ...(bookingThatDay ? { replaceBookingId: bookingThatDay.id } : {}) },
        session: 'athlete',
      })
      toast.success(bookingThatDay ? t('sched', 'movedToast') : t('sched', 'bookedToast'))
      const branchName = props.branches.find((b) => b.id === slot.branchId)?.name ?? ''
      setBookings((list) => [...list.filter((b) => b.id !== bookingThatDay?.id), { ...result, branch: branchName }].sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour))
      await load(day)
      await refreshBookings()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not book')
      await load(day)
    } finally {
      setBusy(null)
    }
  }

  async function cancel(bookingId: string) {
    setBusy(bookingId)
    try {
      await api(`/api/g/${slug}/bookings/${bookingId}`, { method: 'DELETE', session: 'athlete' })
      toast.success(t('sched', 'cancelledToast'))
      setBookings((list) => list.filter((b) => b.id !== bookingId))
      await load(day)
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not cancel')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="a-page">
      <div className="a-head">
        <h1>{t('sched', 'title')}</h1>
      </div>

      <div className="week-strip" role="tablist">
        {props.days.map((iso, index) => {
          const wd = new Date(`${iso}T00:00:00Z`).getUTCDay()
          const planned = !props.restDays.includes(wd) && props.split.some((d) => d.weekday === wd)
          const booked = bookings.some((b) => b.date === iso)
          return (
            <button key={iso} type="button" role="tab" aria-selected={day === iso} className={`week-day ${day === iso ? 'on' : ''}`} onClick={() => load(iso)}>
              <small>{index === 0 ? t('sched', 'todayTag') : dayLabel(iso, lang, { weekday: 'short' })}</small>
              <strong>{dayLabel(iso, lang, { day: 'numeric' })}</strong>
              <span className="dots">
                {planned ? <i className="dot-work" /> : null}
                {booked ? <i className="dot-slot" /> : null}
              </span>
            </button>
          )
        })}
      </div>

      <section className="a-card" id="workout">
        <div className="row-between">
          <h3>
            <Dumbbell /> {workout ? workout.title : props.restDays.includes(weekday) ? t('sched', 'rest') : t('sched', 'yourSplit')}
          </h3>
          {workout ? <span className="pill">{workout.minutes} min</span> : null}
        </div>
        {workout ? (
          <>
            {workout.focus ? <p className="muted">{workout.focus}</p> : null}
            <ol className="ex-list">
              {workout.exercises.map((exercise, index) => (
                <li key={index}>
                  <span>{exercise.name}</span>
                  <strong>
                    {exercise.sets} x {exercise.reps}
                  </strong>
                </li>
              ))}
            </ol>
          </>
        ) : props.split.length === 0 ? (
          <p className="muted">{t('sched', 'noSplit')}</p>
        ) : null}
        {props.dietNotes ? (
          <details className="diet">
            <summary>{t('sched', 'dietNotes')}</summary>
            <p>{props.dietNotes}</p>
          </details>
        ) : null}
      </section>

      {props.slotsEnabled ? (
        <section className="a-card">
          <div className="row-between">
            <h3>{t('sched', 'slotsFor', { day: dayLabel(day, lang, { weekday: 'long', day: 'numeric', month: 'short' }) })}</h3>
            {props.branches.length > 1 ? (
              <select
                className="mini-select"
                value={branchId}
                aria-label={t('sched', 'branch')}
                onChange={(event) => {
                  setBranchId(event.target.value)
                  load(day, event.target.value)
                }}
              >
                {props.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {loading ? (
            <div className="center-pad">
              <Loader2 className="spin" />
            </div>
          ) : slots.filter((slot) => !slot.past || slot.mine).length === 0 ? (
            <p className="muted">{t('sched', 'noSlots')}</p>
          ) : (
            <div className="slot-grid">
              {slots.filter((slot) => !slot.past || slot.mine).map((slot) => {
                const pct = slot.capacity ? Math.round((slot.booked / slot.capacity) * 100) : 100
                const full = slot.left === 0 && !slot.mine
                return (
                  <div key={slot.id} className={`slot-tile ${slot.mine ? 'mine' : ''} ${slot.past ? 'past' : ''} ${full ? 'full' : ''}`}>
                    <div className="slot-top">
                      <strong>{hourLabel(slot.startHour)}</strong>
                      <small>{slot.past ? t('sched', 'past') : full ? t('sched', 'full') : t('sched', 'spotsLeft', { left: slot.left, capacity: slot.capacity })}</small>
                    </div>
                    <div className="slot-bar">
                      <span style={{ width: `${pct}%` }} className={pct >= 90 ? 'hot' : pct >= 60 ? 'warm' : ''} />
                    </div>
                    {slot.past ? null : slot.mine ? (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy === slot.bookingId} onClick={() => slot.bookingId && cancel(slot.bookingId)}>
                        <X /> {t('sched', 'cancelBooking')}
                      </button>
                    ) : full ? null : (
                      <button type="button" className={`btn btn-sm ${bookingThatDay ? 'btn-outline' : 'btn-dark'}`} disabled={busy === slot.id} onClick={() => book(slot)}>
                        {busy === slot.id ? <Loader2 className="spin" /> : bookingThatDay ? <ArrowRightLeft /> : <Check />} {bookingThatDay ? t('sched', 'reschedule') : t('sched', 'book')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <p className="hint">{t('sched', 'reminderNote')}</p>
        </section>
      ) : null}

      {props.slotsEnabled ? (
        <section className="a-card">
          <h3>{t('sched', 'myBookings')}</h3>
          {bookings.length === 0 ? (
            <p className="muted">{t('sched', 'noBookings')}</p>
          ) : (
            <ul className="booking-list">
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <button type="button" className="link-like" onClick={() => load(booking.date)}>
                    <strong>{dayLabel(booking.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</strong> {hourLabel(booking.startHour)}
                    {props.branches.length > 1 ? <small> - {booking.branch}</small> : null}
                  </button>
                  <button type="button" className="icon-btn" title={t('sched', 'cancelBooking')} disabled={busy === booking.id} onClick={() => cancel(booking.id)}>
                    <X />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="a-card">
        <div className="row-between">
          <h3>{props.trainerName ? t('sched', 'byTrainer', { name: props.trainerName }) : t('sched', 'yourSplit')}</h3>
          {!props.trainerName && !editing ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
              <Pencil /> {t('sched', 'editSplit')}
            </button>
          ) : null}
        </div>
        {props.trainerName ? <p className="muted">{t('sched', 'trainerLocked')}</p> : null}
        {editing ? (
          <SplitEditor slug={slug} lang={lang} initial={props.split} onDone={() => setEditing(false)} />
        ) : (
          <SplitSummary lang={lang} split={props.split} restDays={props.restDays} />
        )}
      </section>
    </div>
  )
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function weekdayName(weekday: number, lang: Lang, style: 'short' | 'long' = 'short') {
  // 2026-11-02 is a Monday.
  const date = new Date(Date.UTC(2026, 10, 1 + weekday))
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: style, timeZone: 'UTC' }).format(date)
}

function SplitSummary({ lang, split, restDays }: { lang: Lang; split: WorkoutDay[]; restDays: number[] }) {
  const t = translator(lang)
  if (split.length === 0) return <p className="muted">{t('sched', 'noSplit')}</p>
  return (
    <ul className="split-summary">
      {WEEK_ORDER.map((wd) => {
        const day = split.find((d) => d.weekday === wd)
        return (
          <li key={wd} className={!day || restDays.includes(wd) ? 'rest' : ''}>
            <span>{weekdayName(wd, lang)}</span>
            <strong>{day && !restDays.includes(wd) ? day.title : t('sched', 'rest')}</strong>
          </li>
        )
      })}
    </ul>
  )
}

function SplitEditor({ slug, lang, initial, onDone }: { slug: string; lang: Lang; initial: WorkoutDay[]; onDone: () => void }) {
  const t = translator(lang)
  const router = useRouter()
  const [days, setDays] = useState<WorkoutDay[]>(() => initial.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })))
  const [saving, setSaving] = useState(false)
  const byWeekday = useMemo(() => new Map(days.map((d) => [d.weekday, d])), [days])

  function toggle(weekday: number) {
    setDays((list) => (list.some((d) => d.weekday === weekday) ? list.filter((d) => d.weekday !== weekday) : [...list, { weekday, title: '', focus: '', minutes: 45, exercises: [{ name: '', sets: 3, reps: '10' }] }]))
  }

  function update(weekday: number, patch: Partial<WorkoutDay>) {
    setDays((list) => list.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)))
  }

  async function save() {
    setSaving(true)
    try {
      const clean = days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => e.name.trim()) }))
      await api(`/api/g/${slug}/me/split`, { method: 'PUT', body: { days: clean }, session: 'athlete' })
      toast.success(t('sched', 'splitSaved'))
      onDone()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="split-editor">
      {WEEK_ORDER.map((wd) => {
        const day = byWeekday.get(wd)
        return (
          <div key={wd} className={`split-day ${day ? 'on' : ''}`}>
            <label className="split-day-head">
              <input type="checkbox" checked={Boolean(day)} onChange={() => toggle(wd)} />
              <strong>{weekdayName(wd, lang, 'long')}</strong>
              {!day ? <small>{t('sched', 'rest')}</small> : null}
            </label>
            {day ? (
              <div className="split-day-body">
                <div className="split-row">
                  <input placeholder={t('sched', 'dayTitle')} value={day.title} maxLength={40} onChange={(e) => update(wd, { title: e.target.value })} />
                  <input placeholder={t('sched', 'dayFocus')} value={day.focus} maxLength={60} onChange={(e) => update(wd, { focus: e.target.value })} />
                  <input type="number" min={5} max={240} aria-label={t('sched', 'dayMinutes')} value={day.minutes} onChange={(e) => update(wd, { minutes: Number(e.target.value) || 45 })} />
                </div>
                {day.exercises.map((exercise, index) => (
                  <div key={index} className="split-ex">
                    <input placeholder={t('sched', 'exercise')} value={exercise.name} maxLength={60} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })} />
                    <input type="number" min={1} max={20} aria-label={t('sched', 'sets')} value={exercise.sets} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, sets: Number(e.target.value) || 1 } : x)) })} />
                    <input aria-label={t('sched', 'reps')} value={exercise.reps} maxLength={20} onChange={(e) => update(wd, { exercises: day.exercises.map((x, i) => (i === index ? { ...x, reps: e.target.value } : x)) })} />
                    <button type="button" className="icon-btn" aria-label={t('nav', 'delete')} onClick={() => update(wd, { exercises: day.exercises.filter((_, i) => i !== index) })}>
                      <Trash2 />
                    </button>
                  </div>
                ))}
                {day.exercises.length < 15 ? (
                  <button type="button" className="link-like" onClick={() => update(wd, { exercises: [...day.exercises, { name: '', sets: 3, reps: '10' }] })}>
                    <Plus /> {t('sched', 'addExercise')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="row-between" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDone}>
          {t('nav', 'cancel')}
        </button>
        <button type="button" className="btn btn-dark btn-sm" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="spin" /> : <Check />} {t('sched', 'saveSplit')}
        </button>
      </div>
    </div>
  )
}
