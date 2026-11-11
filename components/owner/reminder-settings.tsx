'use client'

import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'
import { reminderSettingsSchema, type ReminderSettingsInput, type ReminderSettingsOutput } from '@/lib/validation/messaging'
import { DUE_STAGE_TEMPLATES, TEMPLATES, dueNote, renderTemplate, type DueStageTemplate, type WaLang } from '@/lib/messaging/templates'

// Settings > Reminders: which automatic WhatsApp messages go out, when,
// and the dues reminder stages with an editable note inside the approved
// template. Live preview in English, Hindi and Punjabi.

const RENEWAL_CHOICES = [1, 2, 3, 5, 7, 10, 14, 30]
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)
const hourLabel = (hour: number) => `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? 'AM' : 'PM'}`

const TOGGLES: { key: 'renewalReminders' | 'slotReminders' | 'birthdayWishes' | 'anniversaryWishes' | 'weeklyReport' | 'dailyMotivation'; title: string; text: string; feature: string }[] = [
  { key: 'renewalReminders', title: 'Plan ending soon', text: 'A heads-up before a membership ends. Not sent once the member has renewed.', feature: 'dues_reminders' },
  { key: 'slotReminders', title: 'Slot reminders', text: 'About 1 hour before a booked slot. Slots before 9 AM are reminded the evening before.', feature: 'slot_booking' },
  { key: 'birthdayWishes', title: 'Birthday wishes', text: 'On the member\'s birthday, in their language.', feature: 'birthday_wishes' },
  { key: 'anniversaryWishes', title: 'Joining anniversaries', text: '"1 year with us" with their total workouts. Members with a running plan only.', feature: 'birthday_wishes' },
  { key: 'weeklyReport', title: 'Weekly report card', text: 'Sunday evening: days trained, streak, favourite time and progress.', feature: 'weekly_report_card' },
  { key: 'dailyMotivation', title: 'Daily motivation line', text: 'Shown in the member app (not sent on WhatsApp, so it is free).', feature: 'athlete_pwa' },
]

function offsetLabel(days: number): string {
  if (!Number.isFinite(days)) return ''
  if (days === 0) return 'on the due date'
  return days < 0 ? `${-days} day${days === -1 ? '' : 's'} before` : `${days} day${days === 1 ? '' : 's'} after`
}

export function ReminderSettingsForm({ defaults, features, gymName, quota }: { defaults: ReminderSettingsInput; features: string[]; gymName: string; quota: number }) {
  const { run, pending } = useAction()
  const form = useForm<ReminderSettingsInput, unknown, ReminderSettingsOutput>({ resolver: zodResolver(reminderSettingsSchema), defaultValues: defaults })
  const { errors } = form.formState
  const stages = useFieldArray({ control: form.control, name: 'stages' })
  const [previewIndex, setPreviewIndex] = useState(0)
  const [lang, setLang] = useState<WaLang>('EN')
  const has = (feature: string) => features.includes(feature)

  const watched = form.watch()
  const renewalDays = (watched.renewalDays ?? []).map(Number)
  const tone = watched.tone ?? 'friendly'
  const previewStage = watched.stages?.[previewIndex] ?? watched.stages?.[0]

  const preview = useMemo(() => {
    if (!previewStage) return ''
    const template = previewStage.template as DueStageTemplate
    const offset = Number(previewStage.offsetDays) || 0
    if (template === 'kasrat_due_owner_alert') {
      return renderTemplate(template, lang, ['Gurpreet', 'Arjun Mehta', 'FF1001', 'Rs 1,500', String(Math.max(offset, 1)), 'https://kasrat.app/owner/payments?tab=dues'])
    }
    const note = dueNote(template, lang, tone, previewStage.customText)
    return renderTemplate(template, lang, ['Arjun', gymName, 'Rs 1,500', '12 Nov', note, 'https://kasrat.app/p/...'])
  }, [previewStage, lang, tone, gymName])

  function toggleRenewalDay(day: number) {
    const next = renewalDays.includes(day) ? renewalDays.filter((d) => d !== day) : [...renewalDays, day].slice(-3)
    form.setValue('renewalDays', next.sort((a, b) => b - a), { shouldDirty: true, shouldValidate: true })
  }

  const submit = form.handleSubmit((values) => run(() => api('/api/gym/reminders', { method: 'PUT', body: values }), 'Reminder settings saved'))

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <section className="panel">
        <p className="kicker">DUES REMINDERS ON WHATSAPP</p>
        <h2>Automatic reminders with a pay link</h2>
        {!has('dues_reminders') ? <p className="field-error">Dues reminders are not in your Rep+ plan.</p> : null}
        <label className="check-row">
          <input type="checkbox" {...form.register('duesAuto')} disabled={!has('dues_reminders')} /> Send dues reminders automatically
        </label>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="r-hour">Send at (IST)</label>
            <select id="r-hour" {...form.register('sendHour')}>
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
            {errors.sendHour ? <span className="field-error">{errors.sendHour.message}</span> : <span className="hint">Nothing ever goes out between 9 PM and 8 AM.</span>}
          </div>
          <div className="field">
            <label>Tone of the default note</label>
            <div className="seg">
              {(['friendly', 'firm'] as const).map((value) => (
                <label key={value} className={tone === value ? 'on' : ''}>
                  <input type="radio" value={value} {...form.register('tone')} /> {value === 'friendly' ? 'Friendly' : 'Firm'}
                </label>
              ))}
            </div>
            <span className="hint">Used when a stage has no note of its own.</span>
          </div>
        </div>

        <div className="stage-list">
          <div className="stage-head">
            <span>On</span>
            <span>Stage</span>
            <span>When (days from due date)</span>
            <span>Message</span>
            <span>Your note (optional, one line)</span>
            <span />
          </div>
          {stages.fields.map((field, index) => {
            const offset = Number(watched.stages?.[index]?.offsetDays)
            const stageErrors = errors.stages?.[index]
            return (
              <div key={field.id} className={`stage-row ${previewIndex === index ? 'active' : ''}`}>
                <input type="checkbox" aria-label="Stage on" {...form.register(`stages.${index}.enabled`)} />
                <div className="field">
                  <input aria-label="Stage name" {...form.register(`stages.${index}.name`)} />
                  {stageErrors?.name ? <span className="field-error">{stageErrors.name.message}</span> : null}
                </div>
                <div className="field">
                  <input aria-label="Days from due date" type="number" min={-10} max={30} {...form.register(`stages.${index}.offsetDays`)} />
                  {stageErrors?.offsetDays ? <span className="field-error">{stageErrors.offsetDays.message}</span> : <span className="hint">{offsetLabel(offset)}</span>}
                </div>
                <div className="field">
                  <select aria-label="Message" {...form.register(`stages.${index}.template`)}>
                    {DUE_STAGE_TEMPLATES.map((name) => (
                      <option key={name} value={name}>
                        {TEMPLATES[name].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <input aria-label="Note" maxLength={160} placeholder="Default note for your tone" {...form.register(`stages.${index}.customText`)} disabled={watched.stages?.[index]?.template === 'kasrat_due_owner_alert'} />
                  {stageErrors?.customText ? <span className="field-error">{stageErrors.customText.message}</span> : null}
                </div>
                <div className="row-actions">
                  <button type="button" className="icon-btn" title="Preview" onClick={() => setPreviewIndex(index)}>
                    <Eye />
                  </button>
                  <button type="button" className="icon-btn" title="Move up" disabled={index === 0} onClick={() => stages.move(index, index - 1)}>
                    <ArrowUp />
                  </button>
                  <button type="button" className="icon-btn" title="Move down" disabled={index === stages.fields.length - 1} onClick={() => stages.move(index, index + 1)}>
                    <ArrowDown />
                  </button>
                  <button type="button" className="icon-btn" title="Remove" disabled={stages.fields.length <= 1} onClick={() => { stages.remove(index); setPreviewIndex(0) }}>
                    <Trash2 />
                  </button>
                </div>
              </div>
            )
          })}
          {errors.stages?.message ? <span className="field-error">{errors.stages.message}</span> : null}
          {stages.fields.length < 6 ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                const last = Number(watched.stages?.at(-1)?.offsetDays ?? 0)
                stages.append({ name: 'Extra follow-up', offsetDays: Math.min(last + 3, 30), template: 'kasrat_due_followup', customText: '', enabled: true })
              }}
            >
              <Plus /> Add a stage
            </button>
          ) : null}
        </div>

        <div className="wa-preview">
          <div className="wa-preview-head">
            <span>
              Preview: <strong>{previewStage?.name || 'Stage'}</strong>
            </span>
            <div className="seg small">
              {(['EN', 'HI', 'PA'] as const).map((code) => (
                <button type="button" key={code} className={lang === code ? 'on' : ''} onClick={() => setLang(code)}>
                  {code}
                </button>
              ))}
            </div>
          </div>
          <div className="wa-bubble">{preview}</div>
          <p className="hint">
            Members get it in their own language. Your note is sent as written, in every language. Each stage goes out once per due, stops as soon as the due is paid, and the pay link opens your UPI
            QR.
          </p>
        </div>
      </section>

      <section className="panel">
        <p className="kicker">OTHER AUTOMATIC MESSAGES</p>
        <h2>Pick what your members get</h2>
        <div className="toggle-list">
          {TOGGLES.map((toggle) => {
            const allowed = has(toggle.feature)
            return (
              <label key={toggle.key} className={`toggle-row ${allowed ? '' : 'locked'}`}>
                <input type="checkbox" {...form.register(toggle.key)} disabled={!allowed} />
                <span>
                  <strong>{toggle.title}</strong>
                  <small>{allowed ? toggle.text : 'Not in your Rep+ plan'}</small>
                </span>
              </label>
            )
          })}
        </div>
        {watched.renewalReminders && has('dues_reminders') ? (
          <div className="field" style={{ marginTop: 14 }}>
            <label>Plan-ending reminder: days before the end date (up to 3)</label>
            <div className="chip-row">
              {RENEWAL_CHOICES.map((day) => (
                <button type="button" key={day} className={`chip ${renewalDays.includes(day) ? 'on' : ''}`} onClick={() => toggleRenewalDay(day)}>
                  {day} day{day === 1 ? '' : 's'}
                </button>
              ))}
            </div>
            {errors.renewalDays ? <span className="field-error">{errors.renewalDays.message}</span> : null}
          </div>
        ) : null}
        <p className="hint" style={{ marginTop: 12 }}>
          Your plan includes {quota.toLocaleString('en-IN')} WhatsApp messages a month. Birthday wishes, anniversaries and weekly reports pause at 90% so dues reminders always have room. Members can reply
          STOP to opt out.
        </p>
      </section>

      <div>
        <button className="btn btn-dark" disabled={pending}>
          {pending ? <Loader2 className="spin" /> : <Save />} Save reminder settings
        </button>
      </div>
    </form>
  )
}
