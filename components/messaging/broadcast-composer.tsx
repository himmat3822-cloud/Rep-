'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellRing, CalendarClock, Loader2, MessageCircle, Moon, Send, Smartphone, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'

// One form for both "send now" and "automatic message" rules:
// who (member group + branch + trainer) -> what (ready message or own words)
// -> how (app first / WhatsApp / app only) -> live preview -> send or save.

export type Segment = 'all' | 'new' | 'inactive' | 'ending' | 'expired' | 'dues' | 'regular'
export type PresetKey = 'miss_you' | 'welcome' | 'renew' | 'ending' | 'consistency' | 'challenge' | 'dues'
export type Channel = 'AUTO' | 'WHATSAPP' | 'PUSH'

export interface ComposerValue {
  name: string
  segment: Segment
  days: number | null
  branchId: string | null
  trainerId: string | null
  preset: PresetKey | null
  customText: string
  channel: Channel
  cooldownDays: number
}

interface Preview {
  label: string
  count: number
  sample: { name: string; line: string }[]
  withApp: number
  whatsappNeeded: number
  quotaLeft: number
  quiet: boolean
  sendsAt: string
}

export const SEGMENT_OPTIONS: { key: Segment; label: string; days?: { default: number; min: number; max: number; unit: string } }[] = [
  { key: 'all', label: 'All current members' },
  { key: 'inactive', label: 'Not coming for', days: { default: 7, min: 2, max: 90, unit: 'days or more' } },
  { key: 'new', label: 'New members, joined in last', days: { default: 14, min: 1, max: 90, unit: 'days' } },
  { key: 'ending', label: 'Plan ending in next', days: { default: 7, min: 1, max: 30, unit: 'days' } },
  { key: 'expired', label: 'Plan ended in last', days: { default: 30, min: 1, max: 365, unit: 'days' } },
  { key: 'dues', label: 'Pending dues' },
  { key: 'regular', label: 'Regulars' },
]

export const SUGGESTED: Record<Segment, PresetKey> = { all: 'challenge', new: 'welcome', inactive: 'miss_you', ending: 'ending', expired: 'renew', dues: 'dues', regular: 'consistency' }

const CHANNELS: { key: Channel; title: string; note: string; icon: typeof Smartphone }[] = [
  { key: 'AUTO', title: 'App first, then WhatsApp', note: 'Free app notification; WhatsApp only for members without the app', icon: Smartphone },
  { key: 'WHATSAPP', title: 'WhatsApp to everyone', note: 'Uses your monthly WhatsApp messages', icon: MessageCircle },
  { key: 'PUSH', title: 'App notification only', note: 'Free; members without the app are skipped', icon: BellRing },
]

export function emptyValue(segment: Segment = 'inactive'): ComposerValue {
  const option = SEGMENT_OPTIONS.find((o) => o.key === segment)
  return { name: '', segment, days: option?.days?.default ?? null, branchId: null, trainerId: null, preset: SUGGESTED[segment], customText: '', channel: 'AUTO', cooldownDays: 14 }
}

function payload(value: ComposerValue) {
  return {
    audience: { segment: value.segment, days: value.days ?? undefined, branchId: value.branchId, trainerId: value.trainerId },
    message: { preset: value.preset, customText: value.preset ? null : value.customText.trim() || null, channel: value.channel },
  }
}

export function BroadcastComposer({
  mode,
  branches,
  trainers,
  presets,
  initial,
  ruleId,
  onDone,
  lockBranch = null,
}: {
  mode: 'send' | 'rule'
  branches: { id: string; name: string }[]
  trainers: { id: string; name: string }[]
  presets: { key: PresetKey; label: string; example: string }[]
  initial?: ComposerValue
  ruleId?: string
  onDone?: () => void
  // One-branch dashboard: the branch cannot be changed here. New messages
  // go only to this branch; an existing all-branches rule stays as it is.
  lockBranch?: { id: string; name: string } | null
}) {
  const router = useRouter()
  const [value, setValue] = useState<ComposerValue>(initial ?? { ...emptyValue(), branchId: lockBranch?.id ?? null })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const seq = useRef(0)

  const set = <K extends keyof ComposerValue>(key: K, next: ComposerValue[K]) => {
    setConfirming(false)
    setValue((current) => ({ ...current, [key]: next }))
  }
  const option = SEGMENT_OPTIONS.find((o) => o.key === value.segment)!
  const messageReady = value.preset !== null || value.customText.trim().length >= 3
  const body = useMemo(() => JSON.stringify(payload(value)), [value])

  useEffect(() => {
    if (!messageReady) {
      setPreview(null)
      return
    }
    const mine = ++seq.current
    setChecking(true)
    const timer = setTimeout(async () => {
      try {
        const result = await api<Preview>('/api/gym/broadcasts/preview', { method: 'POST', body: JSON.parse(body) })
        if (mine === seq.current) setPreview(result)
      } catch {
        if (mine === seq.current) setPreview(null)
      } finally {
        if (mine === seq.current) setChecking(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [body, messageReady])

  function pickSegment(segment: Segment) {
    const next = SEGMENT_OPTIONS.find((o) => o.key === segment)!
    setConfirming(false)
    setValue((current) => ({ ...current, segment, days: next.days?.default ?? null, preset: current.preset === SUGGESTED[current.segment] || current.preset === null ? (current.customText.trim() ? null : SUGGESTED[segment]) : current.preset }))
  }

  async function submit() {
    if (mode === 'send' && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    try {
      if (mode === 'send') {
        const result = await api<{ total: number; quiet: boolean }>('/api/gym/broadcasts', { method: 'POST', body: JSON.parse(body) })
        toast.success(result.quiet ? `Queued for ${result.total} members. It goes out at 8 AM (quiet hours).` : `Sending to ${result.total} members now`)
        setConfirming(false)
        setValue(emptyValue(value.segment))
      } else {
        const rule = { name: value.name.trim() || preview?.label || 'Automatic message', ...JSON.parse(body), cooldownDays: value.cooldownDays, enabled: true }
        await api(ruleId ? `/api/gym/auto-rules/${ruleId}` : '/api/gym/auto-rules', { method: ruleId ? 'PUT' : 'POST', body: rule })
        toast.success(ruleId ? 'Automatic message updated' : 'Automatic message is on. It runs every morning.')
      }
      router.refresh()
      onDone?.()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const overQuota = preview ? preview.whatsappNeeded > preview.quotaLeft : false
  const sendsAt = preview ? new Date(preview.sendsAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''

  return (
    <div className="bc-form">
      {mode === 'rule' ? (
        <label className="bc-block">
          <span className="bc-step">Name</span>
          <input className="bc-input" value={value.name} maxLength={80} placeholder="Example: Bring back members who stopped coming" onChange={(event) => set('name', event.target.value)} />
        </label>
      ) : null}

      <div className="bc-block">
        <span className="bc-step">
          <Users /> Who gets it
        </span>
        <div className="bc-chips" role="radiogroup" aria-label="Member group">
          {SEGMENT_OPTIONS.map((item) => (
            <button key={item.key} type="button" role="radio" aria-checked={value.segment === item.key} className={value.segment === item.key ? 'on' : ''} onClick={() => pickSegment(item.key)}>
              {item.label}
              {item.days ? ' ...' : ''}
            </button>
          ))}
        </div>
        <div className="bc-row">
          {option.days ? (
            <label className="bc-days">
              {option.label}
              <input type="number" inputMode="numeric" min={option.days.min} max={option.days.max} value={value.days ?? option.days.default} onChange={(event) => set('days', Math.min(option.days!.max, Math.max(option.days!.min, Number(event.target.value) || option.days!.min)))} />
              {option.days.unit}
            </label>
          ) : null}
          {lockBranch ? (
            <span className="bc-lock">{value.branchId === lockBranch.id ? `Only ${lockBranch.name}` : value.branchId ? (branches.find((b) => b.id === value.branchId)?.name ?? 'Other branch') : 'All branches'}</span>
          ) : branches.length > 1 ? (
            <select className="bc-select" value={value.branchId ?? ''} onChange={(event) => set('branchId', event.target.value || null)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          ) : null}
          {trainers.length > 0 ? (
            <select className="bc-select" value={value.trainerId ?? ''} onChange={(event) => set('trainerId', event.target.value || null)} aria-label="Trainer">
              <option value="">Any trainer</option>
              {trainers.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.name}&apos;s members
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div className="bc-block">
        <span className="bc-step">
          <MessageCircle /> What it says
        </span>
        <div className="bc-presets" role="radiogroup" aria-label="Message">
          {[...presets].sort((a, b) => (a.key === SUGGESTED[value.segment] ? -1 : b.key === SUGGESTED[value.segment] ? 1 : 0)).map((preset) => (
            <button key={preset.key} type="button" role="radio" aria-checked={value.preset === preset.key} className={`bc-preset ${value.preset === preset.key ? 'on' : ''}`} onClick={() => set('preset', preset.key)}>
              <strong>
                {preset.label}
                {preset.key === SUGGESTED[value.segment] ? <em>Suggested</em> : null}
              </strong>
              <span>{preset.example}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={value.preset === null} className={`bc-preset own ${value.preset === null ? 'on' : ''}`} onClick={() => set('preset', null)}>
            <strong>Write my own</strong>
            <span>Same words for everyone, in the language you type</span>
          </button>
        </div>
        {value.preset === null ? <textarea className="bc-input" rows={3} maxLength={300} value={value.customText} placeholder="Example: Gym stays open 6 AM to 1 PM on Sunday for Gurpurab. Waheguru mehar kare!" onChange={(event) => set('customText', event.target.value)} /> : <small className="bc-hint">Ready messages go out in each member&apos;s own language: English, Hindi or Punjabi.</small>}
      </div>

      <div className="bc-block">
        <span className="bc-step">
          <Send /> How
        </span>
        <div className="bc-channels" role="radiogroup" aria-label="Channel">
          {CHANNELS.map((item) => (
            <button key={item.key} type="button" role="radio" aria-checked={value.channel === item.key} className={value.channel === item.key ? 'on' : ''} onClick={() => set('channel', item.key)}>
              <item.icon />
              <span>
                <strong>{item.title}</strong>
                <small>{item.note}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      {mode === 'rule' ? (
        <label className="bc-block bc-days">
          <CalendarClock /> Send the same member this again only after
          <input type="number" inputMode="numeric" min={3} max={365} value={value.cooldownDays} onChange={(event) => set('cooldownDays', Math.min(365, Math.max(3, Number(event.target.value) || 3)))} />
          days
        </label>
      ) : null}

      <div className={`bc-preview ${overQuota ? 'warn' : ''}`} aria-live="polite">
        {!messageReady ? (
          <p className="muted">Pick a message to see who gets it.</p>
        ) : checking && !preview ? (
          <p className="muted">
            <Loader2 className="spin" /> Counting members...
          </p>
        ) : preview ? (
          <>
            <div className="bc-count">
              <strong>{preview.count}</strong>
              <span>
                {mode === 'rule' ? 'members match today' : 'members will get this'}
                <small>{preview.label}</small>
              </span>
            </div>
            {preview.count > 0 ? (
              <ul className="bc-stats">
                {value.channel !== 'WHATSAPP' ? <li>{preview.withApp} by free app notification</li> : null}
                {value.channel !== 'PUSH' ? (
                  <li>
                    {preview.whatsappNeeded} on WhatsApp ({preview.quotaLeft} left this month)
                  </li>
                ) : (
                  <li>{preview.count - preview.withApp} without the app will be skipped</li>
                )}
                {preview.quiet ? (
                  <li>
                    <Moon /> Quiet hours now: {mode === 'rule' ? 'rules run in the morning' : `goes out at ${sendsAt}`}
                  </li>
                ) : null}
              </ul>
            ) : null}
            {overQuota ? <p className="bc-warn">Not enough WhatsApp messages left this month: members past the limit will be skipped. Use &quot;App first&quot; to save messages.</p> : null}
            {preview.sample.length ? (
              <div className="bc-sample">
                {preview.sample.slice(0, 2).map((item) => (
                  <div key={item.name} className="bc-bubble">
                    <small>{item.name}</small>
                    <p>{item.line}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="bc-actions">
        {onDone ? (
          <button type="button" className="button-link outline small-button" onClick={onDone}>
            <X /> Cancel
          </button>
        ) : null}
        <button type="button" className={`btn ${confirming ? 'btn-dark' : 'btn-lime'}`} disabled={busy || !messageReady || (mode === 'send' && (!preview || preview.count === 0))} onClick={submit}>
          {busy ? <Loader2 className="spin" /> : <Send />}
          {mode === 'rule' ? (ruleId ? 'Save changes' : 'Turn on automatic message') : confirming ? `Yes, send to ${preview?.count ?? 0} members` : `Send to ${preview?.count ?? 0} members`}
        </button>
      </div>
    </div>
  )
}
