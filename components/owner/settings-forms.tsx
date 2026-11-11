'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Pencil, Plus, Save, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { branchSchema, gymAppSettingsSchema, gymProfileSchema, staffSchema } from '@/lib/validation/owner'
import { useAction } from '@/components/admin/use-action'
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/auth/permissions'

// ---------------------------------------------------------------------------
// Gym profile + logo
// ---------------------------------------------------------------------------

type ProfileInput = z.input<typeof gymProfileSchema>
type ProfileOutput = z.output<typeof gymProfileSchema>

export function GymProfileForm({ defaults, logo }: { defaults: ProfileInput; logo: string | null }) {
  const { run, pending, router } = useAction()
  const form = useForm<ProfileInput, unknown, ProfileOutput>({ resolver: zodResolver(gymProfileSchema), defaultValues: defaults })
  const { errors } = form.formState
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function upload(file: File) {
    setUploading(true)
    const body = new FormData()
    body.set('file', file)
    const response = await fetch('/api/gym/settings/logo', { method: 'POST', body }).catch(() => null)
    setUploading(false)
    if (!response?.ok) {
      const data = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null
      toast.error(data?.error?.message ?? 'Upload failed')
      return
    }
    toast.success('Logo updated')
    router.refresh()
  }

  return (
    <form className="panel" onSubmit={form.handleSubmit((values) => run(() => api('/api/gym/settings', { method: 'PATCH', body: values }), 'Gym profile saved'))} noValidate>
      <div className="logo-box">
        <div className="logo-img">{logo ? <img src={logo} alt="Gym logo" /> : defaults.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <button className="btn btn-outline btn-sm" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload logo
          </button>
          <p className="muted" style={{ marginTop: 6 }}>
            PNG, JPG, WEBP or SVG, under 2 MB. Shown on invoices and the member app.
          </p>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Gym name</label>
          <input {...form.register('name')} />
          {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
        </div>
        <div className="field">
          <label>City</label>
          <input {...form.register('city')} />
        </div>
        <div className="field full">
          <label>Address (printed on invoices)</label>
          <input {...form.register('address')} />
        </div>
        <div className="field">
          <label>GSTIN</label>
          <input {...form.register('gstNumber')} placeholder="03ABCDE1234F1Z5" />
          {errors.gstNumber ? <span className="field-error">{errors.gstNumber.message}</span> : <span className="hint">Leave empty if not GST registered.</span>}
        </div>
        <div className="field">
          <label>Gym phone</label>
          <input {...form.register('phone')} />
          {errors.phone ? <span className="field-error">{errors.phone.message}</span> : null}
        </div>
        <div className="field">
          <label>Gym email</label>
          <input {...form.register('email')} />
        </div>
      </div>
      <button className="btn btn-dark" type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Save profile
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// App behaviour
// ---------------------------------------------------------------------------

type AppInput = z.input<typeof gymAppSettingsSchema>
type AppOutput = z.output<typeof gymAppSettingsSchema>

export function AppSettingsForm({ defaults, showMemberFeatures }: { defaults: AppInput; showMemberFeatures: { leaderboard: boolean; challenges: boolean; progressPhotos: boolean } }) {
  const { run, pending } = useAction()
  const form = useForm<AppInput, unknown, AppOutput>({ resolver: zodResolver(gymAppSettingsSchema), defaultValues: defaults })
  const { errors } = form.formState
  const err = (name: keyof AppInput) => (errors[name] ? <span className="field-error">{String(errors[name]?.message)}</span> : null)
  return (
    <form className="stack" onSubmit={form.handleSubmit((values) => run(() => api('/api/gym/settings/app', { method: 'PATCH', body: values }), 'Settings saved'))} noValidate>
      <section className="panel">
        <p className="kicker">YOUR PEOPLE</p>
        <h2>What do you call your members?</h2>
        <div className="form-grid">
          <div className="field">
            <label>One person</label>
            <input {...form.register('athleteLabel')} placeholder="Athlete" />
            {err('athleteLabel')}
          </div>
          <div className="field">
            <label>Many people</label>
            <input {...form.register('athleteLabelPlural')} placeholder="Athletes" />
            {err('athleteLabelPlural')}
          </div>
          <div className="field">
            <label>Default app language</label>
            <select {...form.register('defaultLanguage')}>
              <option value="EN">English</option>
              <option value="HI">Hindi</option>
              <option value="PA">Punjabi</option>
            </select>
          </div>
          <label className="check-row" style={{ alignSelf: 'center' }}>
            <input type="checkbox" {...form.register('ownerHandlesDesk')} /> I also manage the reception (desk tools in my menu)
          </label>
        </div>
      </section>

      <section className="panel">
        <p className="kicker">ATTENDANCE</p>
        <h2>Status rules</h2>
        <div className="form-grid">
          <div className="field">
            <label>Regular = visits per week</label>
            <input type="number" {...form.register('regularVisitsPerWeek')} />
          </div>
          <div className="field">
            <label>Average session (minutes, auto checkout)</label>
            <input type="number" {...form.register('sessionMinutes')} />
            {err('sessionMinutes')}
          </div>
          <div className="field">
            <label>Slipping after (days without a visit)</label>
            <input type="number" {...form.register('slippingAfterDays')} />
          </div>
          <div className="field">
            <label>Inactive after (days)</label>
            <input type="number" {...form.register('inactiveAfterDays')} />
            {err('inactiveAfterDays')}
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="kicker">MEMBER APP</p>
        <h2>What members see</h2>
        <div style={{ marginTop: 12 }}>
          {showMemberFeatures.leaderboard ? (
            <label className="check-row">
              <input type="checkbox" {...form.register('leaderboard')} /> Leaderboard (attendance only, members can hide themselves)
            </label>
          ) : null}
          {showMemberFeatures.challenges ? (
            <label className="check-row">
              <input type="checkbox" {...form.register('challenges')} /> Challenges
            </label>
          ) : null}
          {showMemberFeatures.progressPhotos ? (
            <label className="check-row">
              <input type="checkbox" {...form.register('progressPhotos')} /> Progress photos (always private to the member)
            </label>
          ) : null}
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Renew early discount (%)</label>
            <input type="number" {...form.register('renewEarlyDiscountPct')} />
          </div>
          <div className="field">
            <label>Referral reward (free days)</label>
            <input type="number" {...form.register('referralRewardDays')} />
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="kicker">INVOICES</p>
        <h2>Billing your members</h2>
        <div className="form-grid">
          <div className="field">
            <label>Invoice prefix (1-4 letters)</label>
            <input {...form.register('invoicePrefix')} />
            {err('invoicePrefix')}
            <span className="hint">Invoice numbers look like FF/26-27/0001 and restart every April.</span>
          </div>
          <div className="field">
            <label>Your UPI ID for members</label>
            <input {...form.register('memberUpiId')} placeholder="gymname@okicici" />
            {err('memberUpiId')}
          </div>
          <div className="field full">
            <label>Invoice footer</label>
            <input {...form.register('invoiceFooter')} placeholder="Thank you! No refunds after 7 days." />
          </div>
        </div>
      </section>

      <div>
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

type BranchInput = z.input<typeof branchSchema>
type BranchOutput = z.output<typeof branchSchema>
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export interface BranchRow extends BranchInput {
  id: string
  isPrimary: boolean
  members: number
}

export const NEW_BRANCH: BranchInput = {
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  geofenceMeters: 150,
  hourlyCapacity: 40,
  slotMinutes: 60,
  openingHours: { mon: ['05:30', '22:00'], tue: ['05:30', '22:00'], wed: ['05:30', '22:00'], thu: ['05:30', '22:00'], fri: ['05:30', '22:00'], sat: ['06:00', '21:00'], sun: null },
  holidays: [],
  archived: false,
}

function BranchForm({ branch, onDone }: { branch?: BranchRow; onDone: () => void }) {
  const { run, pending } = useAction()
  const form = useForm<BranchInput, unknown, BranchOutput>({ resolver: zodResolver(branchSchema), defaultValues: branch ?? NEW_BRANCH })
  const hours = form.watch('openingHours')
  const [holidayText, setHolidayText] = useState((branch?.holidays ?? []).join(', '))
  const { errors } = form.formState

  async function submit(values: BranchOutput) {
    const holidays = holidayText
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
    const result = await run(() => api(branch ? `/api/gym/branches/${branch.id}` : '/api/gym/branches', { method: branch ? 'PATCH' : 'POST', body: { ...values, holidays } }), branch ? 'Branch saved' : 'Branch added')
    if (result) onDone()
  }

  function locate() {
    if (!navigator.geolocation) return toast.error('Location is not available on this device')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setValue('latitude', Number(position.coords.latitude.toFixed(6)))
        form.setValue('longitude', Number(position.coords.longitude.toFixed(6)))
        toast.success('Location set from this device')
      },
      () => toast.error('Could not read your location'),
    )
  }

  return (
    <form className="action-card" onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label>Branch name</label>
          <input {...form.register('name')} placeholder="Phase 7" />
          {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
        </div>
        <div className="field">
          <label>Address</label>
          <input {...form.register('address')} />
        </div>
        <div className="field">
          <label>People per hour (capacity)</label>
          <input type="number" {...form.register('hourlyCapacity')} />
        </div>
        <div className="field">
          <label>Slot length</label>
          <select {...form.register('slotMinutes')}>
            {[30, 45, 60, 90, 120].map((value) => (
              <option key={value} value={value}>
                {value} minutes
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Latitude / longitude (for self check-in)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input {...form.register('latitude')} placeholder="30.7046" />
            <input {...form.register('longitude')} placeholder="76.7179" />
          </div>
          <button type="button" className="link-button" style={{ alignSelf: 'flex-start' }} onClick={locate}>
            Use my current location (stand inside the gym)
          </button>
        </div>
        <div className="field">
          <label>Check-in radius (metres)</label>
          <input type="number" {...form.register('geofenceMeters')} />
        </div>
      </div>
      <p className="kicker" style={{ marginBottom: 8 }}>
        OPENING HOURS
      </p>
      <div className="hours-grid">
        {DAYS.map((day) => {
          const value = hours?.[day]
          return (
            <div key={day} style={{ display: 'contents' }}>
              <strong style={{ textTransform: 'capitalize' }}>{day}</strong>
              <input type="time" disabled={!value} value={value?.[0] ?? ''} onChange={(event) => form.setValue(`openingHours.${day}`, [event.target.value, value?.[1] ?? '22:00'])} />
              <input type="time" disabled={!value} value={value?.[1] ?? ''} onChange={(event) => form.setValue(`openingHours.${day}`, [value?.[0] ?? '06:00', event.target.value])} />
              <label className="check-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={!value} onChange={(event) => form.setValue(`openingHours.${day}`, event.target.checked ? null : ['06:00', '22:00'])} /> Closed
              </label>
            </div>
          )
        })}
      </div>
      <div className="field">
        <label>Holidays (YYYY-MM-DD, comma separated)</label>
        <input value={holidayText} onChange={(event) => setHolidayText(event.target.value)} placeholder="2026-11-12, 2026-12-25" />
        <span className="hint">Streaks skip holidays.</span>
      </div>
      {branch && !branch.isPrimary ? (
        <label className="check-row">
          <input type="checkbox" {...form.register('archived')} /> Close this branch (archive)
        </label>
      ) : null}
      <div className="actions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save branch
        </button>
        <button className="btn btn-outline" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function BranchesEditor({ branches, canAdd, limitText }: { branches: BranchRow[]; canAdd: boolean; limitText: string }) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="kicker">{limitText}</p>
          <h2>Branches</h2>
        </div>
        <button className="btn btn-lime" type="button" disabled={!canAdd} title={canAdd ? '' : 'Upgrade your plan for more branches'} onClick={() => setEditing('new')}>
          <Plus /> Add branch
        </button>
      </div>
      {editing === 'new' ? <BranchForm onDone={() => setEditing(null)} /> : null}
      <div className="list-rows">
        {branches.map((branch) =>
          editing === branch.id ? (
            <BranchForm key={branch.id} branch={branch} onDone={() => setEditing(null)} />
          ) : (
            <div className="list-row" key={branch.id}>
              <span>
                <strong>{branch.name}</strong> {branch.isPrimary ? <span className="badge badge-lime">Primary</span> : null}
                {branch.archived ? <span className="badge badge-grey">Closed</span> : null}
                <br />
                <small>
                  {branch.address || 'No address'} - {String(branch.hourlyCapacity)}/hour - {String(branch.slotMinutes)} min slots - {branch.members} members
                  {branch.latitude ? '' : ' - location not set'}
                </small>
              </span>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(branch.id)}>
                <Pencil /> Edit
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

type StaffInput = z.input<typeof staffSchema>
type StaffOutput = z.output<typeof staffSchema>

export interface StaffRow {
  id: string
  name: string
  phone: string
  email: string
  kind: 'TRAINER' | 'DESK'
  branchId: string
  grants: string[]
  denies: string[]
  commissionPct: number
  ptSessionFeeRupees: number
  active: boolean
  lastLoginAt: string | null
}

const PERMISSION_LABELS: Record<string, string> = {
  'members.read': 'See members',
  'members.write': 'Add / edit members',
  'members.delete': 'Archive members',
  'attendance.read': 'See attendance',
  'attendance.checkin': 'Check members in',
  'payments.read': 'See payments',
  'payments.collect': 'Collect payments',
  'invoices.issue': 'Issue invoices',
  'dues.manage': 'Waive dues',
  'leads.manage': 'Leads',
  'workouts.manage': 'Workout plans',
  'pt.log': 'Log PT sessions',
  'progress.read': 'See progress (if shared)',
  'freeze.approve': 'Freeze plans',
  'complaints.manage': 'Complaints',
  'reports.read': 'Reports',
}

function StaffForm({ staff, branches, onDone }: { staff?: StaffRow; branches: { id: string; name: string }[]; onDone: () => void }) {
  const { run, pending } = useAction()
  const form = useForm<StaffInput, unknown, StaffOutput>({
    resolver: zodResolver(staffSchema),
    defaultValues: staff ? { ...staff, phone: staff.phone.replace(/^\+91/, '') } : { name: '', phone: '', email: '', kind: 'TRAINER', branchId: branches[0]?.id ?? '', grants: [], denies: [], commissionPct: 0, ptSessionFeeRupees: 0, active: true },
  })
  const kind = form.watch('kind')
  const grants = form.watch('grants') ?? []
  const denies = form.watch('denies') ?? []
  const base = new Set<string>(SYSTEM_ROLES[kind].permissions)
  const { errors } = form.formState

  function toggle(permission: string) {
    const isOn = (base.has(permission) || grants.includes(permission)) && !denies.includes(permission)
    if (base.has(permission)) {
      form.setValue('denies', isOn ? [...denies, permission] : denies.filter((item) => item !== permission))
    } else {
      form.setValue('grants', isOn ? grants.filter((item) => item !== permission) : [...grants, permission])
    }
  }

  async function submit(values: StaffOutput) {
    try {
      const result = await run(() => api(staff ? `/api/gym/staff/${staff.id}` : '/api/gym/staff', { method: staff ? 'PATCH' : 'POST', body: values }), staff ? 'Saved' : `${values.name} can now log in with WhatsApp OTP`)
      if (result) onDone()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not save')
    }
  }

  return (
    <form className="action-card" onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label>Name</label>
          <input {...form.register('name')} />
          {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
        </div>
        <div className="field">
          <label>WhatsApp number (login)</label>
          <div className="phone-input">
            <span>+91</span>
            <input {...form.register('phone')} />
          </div>
          {errors.phone ? <span className="field-error">{errors.phone.message}</span> : null}
        </div>
        <div className="field">
          <label>Role</label>
          <select {...form.register('kind')} onChange={(event) => form.reset({ ...form.getValues(), kind: event.target.value as 'TRAINER' | 'DESK', grants: [], denies: [] })}>
            <option value="TRAINER">Trainer</option>
            <option value="DESK">Front desk</option>
          </select>
        </div>
        <div className="field">
          <label>Branch</label>
          <select {...form.register('branchId')}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
        {kind === 'TRAINER' ? (
          <>
            <div className="field">
              <label>PT session fee (Rs)</label>
              <input type="number" min={0} {...form.register('ptSessionFeeRupees')} />
              <span className="hint">What a member pays for one session with this trainer</span>
            </div>
            <div className="field">
              <label>PT commission (%)</label>
              <input type="number" min={0} max={100} {...form.register('commissionPct')} />
              <span className="hint">Paid only on sessions the member confirms in the app</span>
            </div>
          </>
        ) : null}
        {staff ? (
          <label className="check-row" style={{ alignSelf: 'center' }}>
            <input type="checkbox" {...form.register('active')} /> Can log in
          </label>
        ) : null}
      </div>
      <p className="kicker" style={{ marginBottom: 6 }}>
        PERMISSIONS
      </p>
      <div className="feature-grid">
        {PERMISSIONS.filter((permission) => PERMISSION_LABELS[permission]).map((permission) => {
          const on = (base.has(permission) || grants.includes(permission)) && !denies.includes(permission)
          return (
            <label key={permission} className={`feature-chip ${on ? 'on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(permission)} />
              {PERMISSION_LABELS[permission]}
            </label>
          )
        })}
      </div>
      <div className="actions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </button>
        <button className="btn btn-outline" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function StaffEditor({ staff, branches, limitText, canAdd, deskEnabled }: { staff: StaffRow[]; branches: { id: string; name: string }[]; limitText: string; canAdd: boolean; deskEnabled: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="kicker">{limitText}</p>
          <h2>Trainers and front desk</h2>
        </div>
        <button className="btn btn-lime" type="button" disabled={!canAdd} onClick={() => setEditing('new')}>
          <Plus /> Add staff
        </button>
      </div>
      {deskEnabled ? (
        <p className="muted" style={{ marginTop: 8 }}>
          You handle the front desk yourself, so you do not need a desk account. Turn that off in App settings if you hire a receptionist.
        </p>
      ) : null}
      {editing === 'new' ? <StaffForm branches={branches} onDone={() => setEditing(null)} /> : null}
      <div className="list-rows">
        {staff.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No staff yet.</p> : null}
        {staff.map((member) =>
          editing === member.id ? (
            <StaffForm key={member.id} staff={member} branches={branches} onDone={() => setEditing(null)} />
          ) : (
            <div className="list-row" key={member.id}>
              <span>
                <strong>{member.name}</strong> <span className={`badge ${member.kind === 'TRAINER' ? 'badge-orange' : 'badge-purple'}`}>{member.kind === 'TRAINER' ? 'Trainer' : 'Front desk'}</span>
                {!member.active ? <span className="badge badge-grey">Disabled</span> : null}
                <br />
                <small>
                  {member.phone} - last login {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleDateString('en-IN') : 'never'}
                  {member.grants.length ? ` - extra: ${member.grants.map((key) => PERMISSION_LABELS[key] ?? key).join(', ')}` : ''}
                </small>
              </span>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(member.id)}>
                <Pencil /> Edit
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  )
}
