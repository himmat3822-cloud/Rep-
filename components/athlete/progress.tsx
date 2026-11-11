'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Columns2, Dumbbell, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'
import { progressLogSchema, recordSchema, type ProgressLogInput, type ProgressLogOutput, type RecordInput, type RecordOutput } from '@/lib/validation/athlete'

// Progress tab pieces: heatmap, weight chart, body log, private photos with
// before/after, personal records.

function fail(error: unknown, fallback: string) {
  toast.error(error instanceof ApiClientError ? error.message : fallback)
}

// --- Heatmap ---------------------------------------------------------------
export function Heatmap({ cells }: { cells: { date: string; count: number }[] }) {
  // Pad the start so columns are Monday-first weeks.
  const first = new Date(`${cells[0].date}T00:00:00Z`).getUTCDay()
  const pad = (first + 6) % 7
  const all = [...Array.from({ length: pad }, () => null), ...cells]
  const weeks: ((typeof cells)[number] | null)[][] = []
  for (let i = 0; i < all.length; i += 7) weeks.push(all.slice(i, i + 7))
  return (
    <div className="heat-scroll">
      <div className="heat-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}>
        {weeks.map((week, w) => (
          <div key={w} className="heat-col">
            {Array.from({ length: 7 }, (_, d) => {
              const cell = week[d]
              return <span key={d} className={`heat-cell ${cell ? (cell.count >= 2 ? 'l3' : cell.count === 1 ? 'l2' : 'l0') : 'blank'}`} title={cell ? `${cell.date}: ${cell.count}` : ''} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Weight chart (tiny inline SVG, no chart library) -----------------------
export function WeightChart({ points, empty }: { points: { date: string; value: number }[]; empty: string }) {
  if (points.length < 2) return <p className="muted">{empty}</p>
  const width = 320
  const height = 120
  const values = points.map((p) => p.value)
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const x = (i: number) => 8 + (i / (points.length - 1)) * (width - 16)
  const y = (v: number) => 10 + (1 - (v - min) / (max - min)) * (height - 30)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg className="weight-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weight trend">
      <path d={`${line} L${x(points.length - 1)},${height - 18} L${x(0)},${height - 18} Z`} className="area" />
      <path d={line} className="line" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="4" className="dot" />
      <text x={x(points.length - 1) - 4} y={y(last.value) - 8} textAnchor="end">
        {last.value} kg
      </text>
      <text x={8} y={height - 4} className="axis">
        {points[0].date.slice(5)}
      </text>
      <text x={width - 8} y={height - 4} textAnchor="end" className="axis">
        {last.date.slice(5)}
      </text>
    </svg>
  )
}

// --- Body log --------------------------------------------------------------
const FIELDS = [
  ['weightKg', 'weight'],
  ['chestCm', 'chest'],
  ['waistCm', 'waist'],
  ['hipsCm', 'hips'],
  ['armsCm', 'arms'],
  ['thighsCm', 'thighs'],
  ['bodyFatPct', 'bodyFat'],
] as const

export function BodyLog({ slug, lang, today }: { slug: string; lang: Lang; today: Partial<Record<(typeof FIELDS)[number][0], number | null>> | null }) {
  const t = translator(lang)
  const router = useRouter()
  const defaults = Object.fromEntries(FIELDS.map(([key]) => [key, today?.[key] ?? ''])) as ProgressLogInput
  const form = useForm<ProgressLogInput, unknown, ProgressLogOutput>({ resolver: zodResolver(progressLogSchema), defaultValues: defaults })
  const rootError = form.formState.errors.root?.message ?? (form.formState.errors as { message?: string }).message

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/api/g/${slug}/me/progress`, { method: 'POST', body: values, session: 'athlete' })
      toast.success(t('prog', 'saved'))
      router.refresh()
    } catch (error) {
      fail(error, 'Could not save')
    }
  })

  return (
    <form className="a-card" onSubmit={submit} noValidate>
      <h3>{t('prog', 'logBody')}</h3>
      <div className="measure-grid">
        {FIELDS.map(([key, label]) => (
          <label key={key} className="field">
            <span>{t('prog', label)}</span>
            <input type="number" inputMode="decimal" step="0.1" {...form.register(key)} />
            {form.formState.errors[key] ? <span className="field-error">{form.formState.errors[key]?.message}</span> : null}
          </label>
        ))}
      </div>
      {rootError ? <p className="field-error">{t('prog', 'atLeastOne')}</p> : null}
      <button className="btn btn-dark btn-block" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="spin" /> : <Save />} {t('nav', 'save')}
      </button>
    </form>
  )
}

// --- Photos ----------------------------------------------------------------
interface PhotoRow {
  id: string
  pose: string
  takenOn: string
  label: string
  thumb: string | null
  full: string | null
}

export function PhotoGallery({ slug, lang, enabled, photos }: { slug: string; lang: Lang; enabled: boolean; photos: PhotoRow[] }) {
  const t = translator(lang)
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pose, setPose] = useState('front')
  const [uploading, setUploading] = useState(false)
  const [compare, setCompare] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const pair = useMemo(() => picked.map((id) => photos.find((p) => p.id === id)).filter(Boolean).sort((a, b) => a!.takenOn.localeCompare(b!.takenOn)) as PhotoRow[], [picked, photos])

  async function upload(file: File) {
    setUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('pose', pose)
      const response = await fetch(`/api/g/${slug}/me/photos`, { method: 'POST', body })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Upload failed')
      }
      toast.success(t('prog', 'photoAdded'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('prog', 'deletePhoto'))) return
    try {
      await api(`/api/g/${slug}/me/photos/${id}`, { method: 'DELETE', session: 'athlete' })
      toast.success(t('prog', 'photoDeleted'))
      setPicked((list) => list.filter((x) => x !== id))
      router.refresh()
    } catch (error) {
      fail(error, 'Could not delete')
    }
  }

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-2)))
  }

  return (
    <>
      <section className="a-card">
        <p className="tip">{t('prog', 'photosPrivate')}</p>
        {enabled ? (
          <div className="photo-upload">
            <div className="seg small">
              {(['front', 'side', 'back'] as const).map((value) => (
                <button key={value} type="button" className={pose === value ? 'on' : ''} onClick={() => setPose(value)}>
                  {t('prog', value)}
                </button>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button type="button" className="btn btn-dark" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="spin" /> : <Camera />} {t('prog', 'uploadPhoto')}
            </button>
          </div>
        ) : (
          <p className="muted">{t('prog', 'photosOff')}</p>
        )}
      </section>

      {photos.length > 1 ? (
        <section className="a-card">
          <div className="row-between">
            <h3>
              <Columns2 /> {t('prog', 'compare')}
            </h3>
            <button type="button" className={`btn btn-sm ${compare ? 'btn-dark' : 'btn-outline'}`} onClick={() => setCompare((v) => !v)}>
              {compare ? t('nav', 'cancel') : t('prog', 'compare')}
            </button>
          </div>
          {compare ? (
            pair.length === 2 ? (
              <div className="compare">
                {pair.map((photo, index) => (
                  <figure key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.full ?? ''} alt="" />
                    <figcaption>
                      {index === 0 ? t('prog', 'before') : t('prog', 'after')} - {photo.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="muted">{t('prog', 'pickTwo')}</p>
            )
          ) : null}
        </section>
      ) : null}

      <div className="photo-grid">
        {photos.map((photo) => (
          <div key={photo.id} className={`photo-tile ${picked.includes(photo.id) ? 'picked' : ''}`}>
            <button type="button" className="photo-hit" onClick={() => (compare ? toggle(photo.id) : photo.full && window.open(photo.full, '_blank'))}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photo.thumb ? <img src={photo.thumb} alt="" loading="lazy" /> : <span className="photo-missing" />}
            </button>
            <div className="photo-meta">
              <small>
                {photo.label} - {t('prog', photo.pose as 'front' | 'side' | 'back')}
              </small>
              <button type="button" className="icon-btn" aria-label={t('prog', 'deletePhoto')} onClick={() => remove(photo.id)}>
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// --- Personal records ------------------------------------------------------
interface RecordRow {
  id: string
  exercise: string
  weightKg: number
  reps: number
  achievedOn: string
  label: string
}

export function RecordsPanel({ slug, lang, records }: { slug: string; lang: Lang; records: RecordRow[] }) {
  const t = translator(lang)
  const router = useRouter()
  const form = useForm<RecordInput, unknown, RecordOutput>({ resolver: zodResolver(recordSchema), defaultValues: { exercise: '', weightKg: '' as unknown as number, reps: 1 } })
  const best = useMemo(() => {
    const map = new Map<string, RecordRow>()
    for (const record of records) {
      const key = record.exercise.trim().toLowerCase()
      const current = map.get(key)
      if (!current || record.weightKg > current.weightKg || (record.weightKg === current.weightKg && record.reps > current.reps)) map.set(key, record)
    }
    return [...map.values()].sort((a, b) => b.weightKg - a.weightKg)
  }, [records])

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/api/g/${slug}/me/records`, { method: 'POST', body: values, session: 'athlete' })
      toast.success(t('prog', 'recordSaved'))
      form.reset({ exercise: '', weightKg: '' as unknown as number, reps: 1 })
      router.refresh()
    } catch (error) {
      fail(error, 'Could not save')
    }
  })

  async function remove(id: string) {
    try {
      await api(`/api/g/${slug}/me/records/${id}`, { method: 'DELETE', session: 'athlete' })
      router.refresh()
    } catch (error) {
      fail(error, 'Could not delete')
    }
  }

  return (
    <>
      <form className="a-card" onSubmit={submit} noValidate>
        <h3>
          <Plus /> {t('prog', 'addRecord')}
        </h3>
        <div className="record-form">
          <label className="field">
            <span>{t('prog', 'liftName')}</span>
            <input list="lifts" placeholder="Bench press" {...form.register('exercise')} />
            <datalist id="lifts">
              {['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Pull-ups', 'Barbell row', 'Leg press'].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {form.formState.errors.exercise ? <span className="field-error">{form.formState.errors.exercise.message}</span> : null}
          </label>
          <label className="field">
            <span>{t('prog', 'kg')}</span>
            <input type="number" inputMode="decimal" step="0.5" {...form.register('weightKg')} />
          </label>
          <label className="field">
            <span>{t('prog', 'reps')}</span>
            <input type="number" inputMode="numeric" {...form.register('reps')} />
          </label>
        </div>
        <button className="btn btn-dark btn-block" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="spin" /> : <Save />} {t('nav', 'save')}
        </button>
      </form>

      <section className="a-card">
        <h3>
          <Dumbbell /> {t('prog', 'records')}
        </h3>
        {best.length === 0 ? (
          <p className="muted">{t('prog', 'noData')}</p>
        ) : (
          <div className="pr-grid">
            {best.map((record) => (
              <div key={record.id} className="pr-tile">
                <small>{record.exercise}</small>
                <strong>
                  {record.weightKg} kg <em>x {record.reps}</em>
                </strong>
                <span>{record.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {records.length ? (
        <section className="a-card">
          <h3>{t('prog', 'history')}</h3>
          <ul className="booking-list">
            {records.map((record) => (
              <li key={record.id}>
                <span>
                  <strong>{record.exercise}</strong> {record.weightKg} kg x {record.reps} <small>- {record.label}</small>
                </span>
                <button type="button" className="icon-btn" aria-label={t('nav', 'delete')} onClick={() => remove(record.id)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
