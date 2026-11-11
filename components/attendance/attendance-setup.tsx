'use client'

import { useState } from 'react'
import { Copy, Fingerprint, KeyRound, Loader2, MapPin, PenLine, Plus, Printer, QrCode, RefreshCw, Save, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'

// Owner picks how attendance works at their gym. Every method is built;
// owners switch on only what they actually have.

export interface MethodState {
  deskQr: boolean
  selfCheckin: boolean
  biometric: boolean
  manual: boolean
  selfRequireEntranceQr: boolean
  selfRequireLocation: boolean
  manualAllowWithoutPlan: boolean
}

export interface DeviceRow {
  id: string
  name: string
  kind: string
  vendor: string
  serialNumber: string | null
  keyPrefix: string | null
  branchId: string
  allowedIps: string[]
  active: boolean
  lastSeenAt: string | null
  punches: number
}

const CARDS: { key: 'deskQr' | 'selfCheckin' | 'biometric' | 'manual'; icon: typeof QrCode; title: string; text: string; feature?: string }[] = [
  { key: 'deskQr', icon: ScanLine, title: 'QR at the desk', text: "Members show a QR in their app that changes every 30 seconds. The desk scans it with a phone / laptop camera or a USB / Bluetooth QR scanner.", feature: 'qr' },
  { key: 'selfCheckin', icon: MapPin, title: 'Self check-in', text: 'Members check themselves in: scan the QR poster at the entrance and/or prove they are inside the gym with their phone location. No desk needed.', feature: 'qr' },
  { key: 'biometric', icon: Fingerprint, title: 'Biometric / turnstile', text: 'Your fingerprint or face machine sends punches to Rep+ (ZKTeco / eSSL cloud push, or any device via the API). Or import its exported log file.', feature: 'bio' },
  { key: 'manual', icon: PenLine, title: 'Manual / register', text: 'The desk searches a name and taps check in, or copies a day from the paper register. Good for gyms with no machine.' },
]

export function MethodSettings({ initial, qrInPlan, biometricInPlan }: { initial: MethodState; qrInPlan: boolean; biometricInPlan: boolean }) {
  const { run, pending } = useAction()
  const [state, setState] = useState(initial)
  const toggle = (key: keyof MethodState) => setState((current) => ({ ...current, [key]: !current[key] }))
  const locked = (feature?: string) => (feature === 'qr' && !qrInPlan) || (feature === 'bio' && !biometricInPlan)

  return (
    <section className="panel">
      <p className="kicker">HOW YOUR GYM MARKS ATTENDANCE</p>
      <h2>Pick what you use (one or many)</h2>
      <div className="method-grid">
        {CARDS.map((card) => {
          const off = locked(card.feature)
          const on = state[card.key] && !off
          return (
            <button type="button" key={card.key} className={`method-card ${on ? 'on' : ''}`} disabled={off} onClick={() => toggle(card.key)}>
              <span className="method-icon">
                <card.icon />
              </span>
              <strong>{card.title}</strong>
              <small>{card.text}</small>
              <em>{off ? (card.feature === 'bio' ? 'Not in your plan - Elite or ask Rep+' : 'Not in your plan') : on ? 'On' : 'Off'}</em>
            </button>
          )
        })}
      </div>

      {state.selfCheckin ? (
        <div className="action-card">
          <h3>Self check-in rules</h3>
          <p>Use both for best security. Location only = members can check in from the app while inside the gym. Poster only = anyone who scans the entrance QR.</p>
          <label className="check-row">
            <input type="checkbox" checked={state.selfRequireEntranceQr} onChange={() => toggle('selfRequireEntranceQr')} /> Must scan the entrance QR poster
          </label>
          <label className="check-row">
            <input type="checkbox" checked={state.selfRequireLocation} onChange={() => toggle('selfRequireLocation')} /> Must be inside the gym (phone location, set in Branches)
          </label>
        </div>
      ) : null}
      {state.manual ? (
        <label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={state.manualAllowWithoutPlan} onChange={() => toggle('manualAllowWithoutPlan')} /> Desk may check in someone whose plan has lapsed (shown as a warning)
        </label>
      ) : null}
      <div className="actions">
        <button className="btn btn-dark" type="button" disabled={pending} onClick={() => run(() => api('/api/gym/attendance/settings', { method: 'PATCH', body: state }), 'Attendance methods saved')}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </button>
      </div>
    </section>
  )
}

export function EntrancePosters({ branches }: { branches: { id: string; name: string; hasLocation: boolean }[] }) {
  const { run, pending } = useAction()
  return (
    <section className="panel">
      <p className="kicker">SELF CHECK-IN</p>
      <h2>Entrance QR posters</h2>
      <div className="list-rows">
        {branches.map((branch) => (
          <div className="list-row" key={branch.id}>
            <span>
              <strong>{branch.name}</strong>
              <br />
              <small>{branch.hasLocation ? 'Location set' : 'Location not set - set it in Branches for the location check'}</small>
            </span>
            <span className="toolbar">
              <a className="btn btn-outline btn-sm" href={`/owner/settings/attendance/poster/${branch.id}`} target="_blank" rel="noreferrer">
                <Printer /> Print poster
              </a>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm('Make a new QR for this branch? The old printed poster stops working.')) void run(() => api(`/api/gym/branches/${branch.id}/entrance`, { method: 'POST' }), 'New entrance QR created. Print the new poster.')
                }}
              >
                <RefreshCw /> New code
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DeviceManager({ devices, branches, inPlan, appUrl }: { devices: DeviceRow[]; branches: { id: string; name: string }[]; inPlan: boolean; appUrl: string }) {
  const { run, pending } = useAction()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: 'Front door reader', branchId: branches[0]?.id ?? '', kind: 'ADMS' as 'ADMS' | 'API', vendor: 'eSSL', serialNumber: '' })
  const [shownKey, setShownKey] = useState<string | null>(null)
  const host = appUrl.replace(/^https?:\/\//, '')

  async function add() {
    const result = await run(() => api<{ id: string; apiKey: string | null }>('/api/gym/attendance/devices', { method: 'POST', body: { ...form, allowedIps: [], active: true } }), 'Device added')
    if (result) {
      setAdding(false)
      if (result.apiKey) setShownKey(result.apiKey)
    }
  }

  async function rotate(id: string) {
    if (!window.confirm('Create a new key? The device stops working until you paste the new key into it.')) return
    const result = await run(() => api<{ apiKey: string }>(`/api/gym/attendance/devices/${id}/rotate`, { method: 'POST' }), 'New key created')
    if (result) setShownKey(result.apiKey)
  }

  async function toggle(device: DeviceRow) {
    await run(() => api(`/api/gym/attendance/devices/${device.id}`, { method: 'PATCH', body: { name: device.name, branchId: device.branchId, kind: device.kind, vendor: device.vendor, allowedIps: device.allowedIps, active: !device.active } }), device.active ? 'Device disabled' : 'Device enabled')
  }

  if (!inPlan) {
    return (
      <section className="panel">
        <p className="kicker">BIOMETRIC / TURNSTILE</p>
        <h2>Machines</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Device integration is part of the Elite plan. Ask Rep+ to enable it for your gym, or import the machine&apos;s CSV log once enabled.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="kicker">BIOMETRIC / TURNSTILE</p>
          <h2>Machines</h2>
        </div>
        <button className="btn btn-lime" type="button" onClick={() => setAdding(true)}>
          <Plus /> Add machine
        </button>
      </div>
      {shownKey ? (
        <div className="action-card danger-zone">
          <h3>
            <KeyRound size={14} /> Device key (shown once)
          </h3>
          <p>Paste this into the device / bridge as a Bearer token for POST https://{host}/api/devices/punches</p>
          <div className="inline">
            <input className="grow mono" readOnly value={shownKey} onFocus={(event) => event.target.select()} />
            <button
              className="btn btn-dark btn-sm"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(shownKey)
                toast.success('Copied')
              }}
            >
              <Copy /> Copy
            </button>
          </div>
        </div>
      ) : null}
      {adding ? (
        <div className="action-card">
          <div className="form-grid" style={{ marginTop: 0 }}>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="field">
              <label>Branch</label>
              <select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Connection</label>
              <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as 'ADMS' | 'API' })}>
                <option value="ADMS">ZKTeco / eSSL cloud push (ADMS)</option>
                <option value="API">Other device or bridge (API key)</option>
              </select>
            </div>
            <div className="field">
              <label>Brand</label>
              <input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} placeholder="eSSL, ZKTeco, Realtime, Matrix" />
            </div>
            {form.kind === 'ADMS' ? (
              <div className="field full">
                <label>Serial number (on the device: Menu &gt; System info)</label>
                <input value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} />
                <span className="hint">
                  On the machine: Comm &gt; Cloud server setting &gt; Server address {host}, port 443, HTTPS on.
                </span>
              </div>
            ) : null}
          </div>
          <div className="actions">
            <button className="btn btn-dark" type="button" disabled={pending} onClick={add}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Save machine
            </button>
            <button className="btn btn-outline" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <div className="list-rows">
        {devices.length === 0 && !adding ? <p className="muted" style={{ paddingTop: 10 }}>No machines yet. You can still import a CSV log from the Attendance page.</p> : null}
        {devices.map((device) => (
          <div className="list-row" key={device.id}>
            <span>
              <strong>{device.name}</strong> <span className={`badge ${device.active ? 'badge-lime' : 'badge-grey'}`}>{device.active ? 'Active' : 'Disabled'}</span>
              <br />
              <small>
                {device.kind === 'ADMS' ? `ADMS - SN ${device.serialNumber}` : `API - key kd_${device.keyPrefix}_...`} - {branches.find((b) => b.id === device.branchId)?.name} -{' '}
                {device.lastSeenAt ? `last seen ${new Date(device.lastSeenAt).toLocaleString('en-IN')}` : 'never connected'} - {device.punches} check-ins
              </small>
            </span>
            <span className="toolbar">
              {device.kind === 'API' ? (
                <button className="btn btn-outline btn-sm" type="button" disabled={pending} onClick={() => rotate(device.id)}>
                  <KeyRound /> New key
                </button>
              ) : null}
              <button className="btn btn-outline btn-sm" type="button" disabled={pending} onClick={() => toggle(device)}>
                {device.active ? 'Disable' : 'Enable'}
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
