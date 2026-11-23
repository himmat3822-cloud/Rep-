'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { BroadcastComposer, emptyValue, type Channel, type ComposerValue, type PresetKey, type Segment } from './broadcast-composer'

// Automatic messages: list, switch on/off, edit, delete, and one-tap starters.

export interface RuleView {
  id: string
  name: string
  audienceLabel: string
  segment: Segment
  days: number | null
  branchId: string | null
  trainerId: string | null
  preset: PresetKey | null
  presetLabel: string | null
  customText: string | null
  channel: Channel
  cooldownDays: number
  enabled: boolean
  lastRun: string | null
  sent30: number
}

const CHANNEL_LABEL: Record<Channel, string> = { AUTO: 'App first, then WhatsApp', WHATSAPP: 'WhatsApp', PUSH: 'App only' }

const STARTERS: { title: string; note: string; value: ComposerValue }[] = [
  { title: 'Bring back members who stopped coming', note: 'Not coming for 7+ days: "We miss you", at most every 14 days', value: { ...emptyValue('inactive'), name: 'Bring back members who stopped coming', cooldownDays: 14 } },
  { title: 'Welcome new members', note: 'Joined yesterday or today: "Welcome", once', value: { ...emptyValue('new'), name: 'Welcome new members', days: 1, cooldownDays: 365 } },
  { title: 'Win back expired plans', note: 'Plan ended in the last 7 days: "Come back and renew", at most monthly', value: { ...emptyValue('expired'), name: 'Win back expired plans', days: 7, cooldownDays: 30 } },
]

export function AutoRules({ rules, branches, trainers, presets, lockBranch = null }: { rules: RuleView[]; branches: { id: string; name: string }[]; trainers: { id: string; name: string }[]; presets: { key: PresetKey; label: string; example: string }[]; lockBranch?: { id: string; name: string } | null }) {
  // One-branch dashboard: new rules only reach the open branch.
  const fresh = (value: ComposerValue): ComposerValue => (lockBranch ? { ...value, branchId: lockBranch.id } : value)
  const router = useRouter()
  const [editing, setEditing] = useState<{ id?: string; value: ComposerValue } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id)
    try {
      await fn()
      toast.success(done)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not save. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (editing) {
    return (
      <section className="panel">
        <h3 className="bc-title">{editing.id ? 'Edit automatic message' : 'New automatic message'}</h3>
        <BroadcastComposer mode="rule" branches={branches} trainers={trainers} presets={presets} initial={editing.value} ruleId={editing.id} lockBranch={lockBranch} onDone={() => setEditing(null)} />
      </section>
    )
  }

  return (
    <div className="bc-rules">
      {rules.length === 0 ? (
        <section className="panel">
          <h3 className="bc-title">Start with one of these</h3>
          <div className="bc-starters">
            {STARTERS.map((starter) => (
              <button key={starter.title} type="button" className="bc-starter" onClick={() => setEditing({ value: fresh(starter.value) })}>
                <Zap />
                <span>
                  <strong>{starter.title}</strong>
                  <small>{starter.note}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        rules.map((rule) => (
          <section key={rule.id} className={`panel bc-rule ${rule.enabled ? '' : 'off'}`}>
            <div className="bc-rule-head">
              <div>
                <strong>{rule.name}</strong>
                <small>{rule.audienceLabel}</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={rule.enabled ? 'Switch off' : 'Switch on'}
                className={`bc-switch ${rule.enabled ? 'on' : ''}`}
                disabled={busy === rule.id}
                onClick={() => act(rule.id, () => api(`/api/gym/auto-rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } }), rule.enabled ? 'Switched off' : 'Switched on')}
              >
                <span />
              </button>
            </div>
            <p className="bc-rule-msg">{rule.presetLabel ? `"${rule.presetLabel}" ready message` : `"${rule.customText}"`}</p>
            <div className="bc-rule-meta">
              <span>{CHANNEL_LABEL[rule.channel]}</span>
              <span>Same member again after {rule.cooldownDays} days</span>
              <span>{rule.sent30} sent in 30 days</span>
              {rule.lastRun ? <span>Last run {rule.lastRun}</span> : <span>Runs tomorrow morning</span>}
            </div>
            <div className="bc-rule-actions">
              <button
                type="button"
                className="button-link outline small-button"
                onClick={() =>
                  setEditing({ id: rule.id, value: { name: rule.name, segment: rule.segment, days: rule.days, branchId: rule.branchId, trainerId: rule.trainerId, preset: rule.preset, customText: rule.customText ?? '', channel: rule.channel, cooldownDays: rule.cooldownDays } })
                }
              >
                <Pencil /> Edit
              </button>
              <button
                type="button"
                className="button-link outline small-button"
                disabled={busy === rule.id}
                onClick={() => {
                  if (!window.confirm(`Delete "${rule.name}"? Messages it has not sent yet are cancelled.`)) return
                  void act(rule.id, () => api(`/api/gym/auto-rules/${rule.id}`, { method: 'DELETE' }), 'Deleted')
                }}
              >
                {busy === rule.id ? <Loader2 className="spin" /> : <Trash2 />} Delete
              </button>
            </div>
          </section>
        ))
      )}
      <button type="button" className="btn btn-dark" onClick={() => setEditing({ value: fresh({ ...emptyValue('inactive'), name: '' }) })}>
        <Plus /> Add automatic message
      </button>
    </div>
  )
}

export function CancelCampaign({ id, waiting }: { id: string; waiting: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="button-link outline small-button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Stop the ${waiting} messages that have not gone out yet?`)) return
        setBusy(true)
        try {
          await api(`/api/gym/broadcasts/${id}`, { method: 'DELETE' })
          toast.success('Stopped')
          router.refresh()
        } catch (error) {
          toast.error(error instanceof ApiClientError ? error.message : 'Could not stop it')
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 className="spin" /> : null} Stop {waiting} waiting
    </button>
  )
}
