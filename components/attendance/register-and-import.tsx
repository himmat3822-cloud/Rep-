'use client'

import { useMemo, useState } from 'react'
import { ClipboardCheck, FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'

// 1. Manual register: copy a day from the paper register into Rep+.
// 2. Biometric log import: upload the CSV exported from the machine.

export interface RegisterMember {
  id: string
  name: string
  memberCode: string
  branchId: string
}

const HOURS = Array.from({ length: 18 }, (_, index) => index + 5)
const hourLabel = (hour: number) => `${((hour + 11) % 12) + 1} ${hour < 12 ? 'AM' : 'PM'}`

export function ManualRegister({ members, branches, presentByDate }: { members: RegisterMember[]; branches: { id: string; name: string }[]; presentByDate: Record<string, string[]> }) {
  const { run, pending } = useAction()
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [defaultHour, setDefaultHour] = useState(7)
  const [ticked, setTicked] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState('')
  const already = new Set(presentByDate[date] ?? [])
  const list = useMemo(
    () => members.filter((member) => member.branchId === branchId && (!filter || member.name.toLowerCase().includes(filter.toLowerCase()) || member.memberCode.toLowerCase().includes(filter.toLowerCase()))),
    [members, branchId, filter],
  )

  async function save() {
    const entries = Object.entries(ticked).map(([athleteId, hour]) => ({ athleteId, hour }))
    if (!entries.length) return toast.error('Tick the members who came')
    const result = await run(() => api<{ created: number; skipped: number }>('/api/gym/attendance/register', { method: 'POST', body: { branchId, date, entries } }), (r) => `${r.created} visit(s) saved${r.skipped ? `, ${r.skipped} already there` : ''}`)
    if (result) setTicked({})
  }

  return (
    <section className="panel">
      <p className="kicker">PAPER REGISTER</p>
      <h2>Mark attendance for a day</h2>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        For gyms that keep a register. Pick the date, tick who came, and set the time slot if you know it. Already marked people are shown with a tick and skipped.
      </p>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} style={{ minWidth: 0 }} />
        {branches.length > 1 ? (
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        ) : null}
        <select value={defaultHour} onChange={(event) => setDefaultHour(Number(event.target.value))} aria-label="Default time">
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              Default {hourLabel(hour)}
            </option>
          ))}
        </select>
        <input placeholder="Filter names" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minWidth: 0 }} />
      </div>
      <div className="register-list">
        {list.map((member) => {
          const done = already.has(member.id)
          const hour = ticked[member.id]
          return (
            <label key={member.id} className={`register-row ${hour !== undefined ? 'on' : ''} ${done ? 'done' : ''}`}>
              <input
                type="checkbox"
                disabled={done}
                checked={done || hour !== undefined}
                onChange={(event) => {
                  const next = { ...ticked }
                  if (event.target.checked) next[member.id] = defaultHour
                  else delete next[member.id]
                  setTicked(next)
                }}
              />
              <span>
                {member.name} <small>{member.memberCode}</small>
              </span>
              {hour !== undefined ? (
                <select value={hour} onChange={(event) => setTicked({ ...ticked, [member.id]: Number(event.target.value) })} onClick={(event) => event.preventDefault()}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              ) : done ? (
                <small>marked</small>
              ) : null}
            </label>
          )
        })}
      </div>
      <div className="actions">
        <button className="btn btn-dark" type="button" disabled={pending} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} Save {Object.keys(ticked).length} visit(s)
        </button>
      </div>
    </section>
  )
}

export function BiometricImport({ branches, devices }: { branches: { id: string; name: string }[]; devices: { id: string; name: string }[] }) {
  const [file, setFile] = useState<File | null>(null)
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string>('')

  async function upload() {
    if (!file) return toast.error('Choose the exported CSV file')
    setBusy(true)
    const body = new FormData()
    body.set('file', file)
    body.set('branchId', branchId)
    if (deviceId) body.set('deviceId', deviceId)
    try {
      const response = await fetch('/api/gym/attendance/import', { method: 'POST', body })
      const data = (await response.json()) as { checkedIn?: number; checkedOut?: number; duplicates?: number; unknownUsers?: string[]; skippedRows?: number; error?: { message: string } }
      if (!response.ok) throw new ApiClientError(response.status, 'VALIDATION_ERROR', data.error?.message ?? 'Import failed')
      const unknown = data.unknownUsers?.length ? ` Unknown IDs (set them on the member's profile): ${data.unknownUsers.slice(0, 10).join(', ')}` : ''
      setReport(`${data.checkedIn} check-ins, ${data.checkedOut} check-outs, ${data.duplicates} already imported, ${data.skippedRows} unreadable rows.${unknown}`)
      toast.success('Log imported')
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <p className="kicker">BIOMETRIC LOG</p>
      <h2>Import from the machine</h2>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        Export the attendance log as CSV / Excel-CSV from the machine software or USB pen drive. Rep+ finds the user ID and date/time columns and matches users by their Biometric ID (or member code). Importing the same file twice is safe.
      </p>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label>Machine</label>
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Not registered / pen drive</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
        {!deviceId ? (
          <div className="field">
            <label>Branch</label>
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field full">
          <label>CSV file</label>
          <input type="file" accept=".csv,.txt,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
      </div>
      <button className="btn btn-dark" type="button" disabled={busy} onClick={upload}>
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Import log
      </button>
      {report ? <p className="muted" style={{ marginTop: 12 }}>{report}</p> : null}
    </section>
  )
}
