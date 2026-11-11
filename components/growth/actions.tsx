'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Copy, Loader2, Megaphone, Phone, Plus, RefreshCw, Sparkles, Trash2, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'
import {
  announcementSchema,
  challengeSchema,
  EXPENSE_CATEGORIES,
  expenseSchema,
  LEAD_SOURCES,
  leadSchema,
  type AnnouncementInput,
  type AnnouncementOutput,
  type ChallengeInput,
  type ChallengeOutput,
  type ExpenseInput,
  type ExpenseOutput,
  type LeadInput,
  type LeadOutput,
} from '@/lib/validation/growth'
import { CATEGORY_LABEL, SOURCE_LABEL } from '@/lib/growth-labels'

// Client pieces for Phase 8: at-risk outcomes, leads CRM, announcements,
// challenges, complaints, expenses and AI insights.


// Dates picked on the form are Indian dates; send them pinned to IST.
const istAt = (date: string, time = '10:00') => (date ? new Date(`${date}T${time}:00+05:30`).toISOString() : undefined)
const todayInput = (plusDays = 0) => new Date(Date.now() + 5.5 * 3600000 + plusDays * 86400000).toISOString().slice(0, 10)

// --- At-risk ---------------------------------------------------------------

const OUTCOMES = [
  { value: 'REACHED_COMING_BACK', label: 'Coming back' },
  { value: 'RENEWED', label: 'Renewed' },
  { value: 'REACHED_NOT_INTERESTED', label: 'Not interested' },
  { value: 'NO_ANSWER', label: 'No answer' },
] as const

export function RiskOutcome({ id, name }: { id: string; name: string }) {
  const [note, setNote] = useState('')
  const { run, pending } = useAction()
  return (
    <div className="risk-outcome">
      <input value={note} maxLength={300} placeholder={`What did ${name.split(' ')[0]} say? (optional)`} onChange={(e) => setNote(e.target.value)} />
      <div className="row-actions">
        {OUTCOMES.map((o) => (
          <button key={o.value} type="button" className={`btn btn-sm ${o.value === 'NO_ANSWER' ? 'btn-ghost' : 'btn-outline'}`} disabled={pending} onClick={() => run(() => api(`/api/gym/risk/${id}/contact`, { method: 'POST', body: { outcome: o.value, note } }), o.value === 'NO_ANSWER' ? 'Kept on the list to try again' : 'Saved')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RecalculateRisk() {
  const { run, pending } = useAction()
  return (
    <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => api<{ atRisk: number }>('/api/gym/risk/recalculate', { method: 'POST' }), (r) => `List refreshed: ${r.atRisk} to call`)}>
      {pending ? <Loader2 className="spin" /> : <RefreshCw />} Refresh now
    </button>
  )
}

// --- Leads -----------------------------------------------------------------

export function LeadForm({ defaultSource = 'WALK_IN', staff, compact }: { defaultSource?: (typeof LEAD_SOURCES)[number]; staff?: { id: string; name: string }[]; compact?: boolean }) {
  const blank: LeadInput = { name: '', phone: '', source: defaultSource, interest: '', notes: '', assignedToId: '' }
  const form = useForm<LeadInput, unknown, LeadOutput>({ resolver: zodResolver(leadSchema), defaultValues: blank })
  const [follow, setFollow] = useState(todayInput(1))
  const { run, pending } = useAction()
  const errors = form.formState.errors
  return (
    <form
      className="form-grid lead-form"
      onSubmit={form.handleSubmit(async (values) => {
        const done = await run(() => api('/api/gym/leads', { method: 'POST', body: { ...values, nextFollowUpAt: istAt(follow) } }), `${values.name} added to leads`)
        if (done !== null) {
          form.reset(blank)
          setFollow(todayInput(1))
        }
      })}
    >
      <div className="field">
        <label htmlFor="l-name">Name</label>
        <input id="l-name" {...form.register('name')} aria-invalid={Boolean(errors.name)} />
        {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="l-phone">Mobile</label>
        <input id="l-phone" inputMode="tel" placeholder="98765 43210" {...form.register('phone')} aria-invalid={Boolean(errors.phone)} />
        {errors.phone ? <span className="field-error">{errors.phone.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="l-source">Came from</label>
        <select id="l-source" {...form.register('source')}>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="l-interest">Interested in</label>
        <input id="l-interest" placeholder="Weight loss, 3 months, PT..." {...form.register('interest')} />
      </div>
      <div className="field">
        <label htmlFor="l-follow">Follow up on</label>
        <input id="l-follow" type="date" min={todayInput()} value={follow} onChange={(e) => setFollow(e.target.value)} />
      </div>
      {staff && staff.length > 1 && !compact ? (
        <div className="field">
          <label htmlFor="l-assign">Who follows up</label>
          <select id="l-assign" {...form.register('assignedToId')}>
            <option value="">Anyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field full">
        <label htmlFor="l-notes">Notes</label>
        <textarea id="l-notes" rows={2} placeholder="Budget, timing, what they asked about" {...form.register('notes')} />
      </div>
      <div className="full">
        <button className="btn btn-dark" disabled={pending}>
          {pending ? <Loader2 className="spin" /> : <Plus />} Add lead
        </button>
      </div>
    </form>
  )
}

type Panel = 'none' | 'call' | 'convert' | 'lost'

export function LeadActions({ lead, branches }: { lead: { id: string; name: string; phone: string; stage: string }; branches: { id: string; name: string }[] }) {
  const [panel, setPanel] = useState<Panel>('none')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(todayInput(2))
  const [stage, setStage] = useState(lead.stage === 'NEW' ? 'FOLLOW_UP' : lead.stage)
  const [branch, setBranch] = useState(branches[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const { run, pending } = useAction()
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? 'none' : p))
  const wa = `https://wa.me/${lead.phone.replace(/\D/g, '')}`

  return (
    <div className="lead-actions">
      <div className="row-actions">
        <a className="btn btn-outline btn-sm" href={`tel:${lead.phone}`}><Phone /> Call</a>
        <a className="btn btn-outline btn-sm" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>
        <button type="button" className={`btn btn-sm ${panel === 'call' ? 'btn-dark' : 'btn-outline'}`} onClick={() => toggle('call')}>Log call</button>
        <button type="button" className={`btn btn-sm ${panel === 'convert' ? 'btn-dark' : 'btn-lime'}`} onClick={() => toggle('convert')}><UserCheck /> Joined</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle('lost')}>Lost</button>
      </div>
      {panel === 'call' ? (
        <form
          className="lead-panel"
          onSubmit={async (e) => {
            e.preventDefault()
            const done = await run(() => api(`/api/gym/leads/${lead.id}/contact`, { method: 'POST', body: { note, nextFollowUpAt: istAt(next), stage } }), 'Call logged')
            if (done !== null) {
              setNote('')
              setPanel('none')
            }
          }}
        >
          <input value={note} maxLength={500} placeholder="Called, coming for a trial on Saturday" onChange={(e) => setNote(e.target.value)} />
          <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="NEW">New</option>
            <option value="TRIAL">Trial</option>
            <option value="FOLLOW_UP">Follow-up</option>
          </select>
          <input type="date" value={next} min={todayInput()} onChange={(e) => setNext(e.target.value)} aria-label="Next follow-up" />
          <button className="btn btn-dark btn-sm" disabled={pending || note.trim().length < 2}>{pending ? <Loader2 className="spin" /> : <Check />} Save</button>
        </form>
      ) : null}
      {panel === 'convert' ? (
        <div className="lead-panel">
          <span className="hint">Creates the member with this name and number{lead.stage === 'TRIAL' ? '' : ''}. Sell the plan from their page next.</span>
          {branches.length > 1 ? (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Home branch">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={pending || !branch}
            onClick={async () => {
              const result = await run(() => api<{ athleteId: string }>(`/api/gym/leads/${lead.id}/convert`, { method: 'POST', body: { homeBranchId: branch } }), `${lead.name} is now a member`, { refresh: false })
              if (result) window.location.href = `${window.location.pathname.startsWith('/desk') ? '/desk' : '/owner'}/members/${result.athleteId}`
            }}
          >
            {pending ? <Loader2 className="spin" /> : <UserCheck />} Convert to member
          </button>
        </div>
      ) : null}
      {panel === 'lost' ? (
        <form
          className="lead-panel"
          onSubmit={async (e) => {
            e.preventDefault()
            await run(() => api(`/api/gym/leads/${lead.id}`, { method: 'PATCH', body: { stage: 'LOST', lostReason: reason } }), 'Marked as lost')
          }}
        >
          <input value={reason} maxLength={200} placeholder="Too far, price, joined another gym..." onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-dark btn-sm" disabled={pending || reason.trim().length < 2}><X /> Mark lost</button>
        </form>
      ) : null}
    </div>
  )
}

export function ReopenLead({ id }: { id: string }) {
  const { run, pending } = useAction()
  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/leads/${id}`, { method: 'PATCH', body: { stage: 'FOLLOW_UP', nextFollowUpAt: istAt(todayInput()) } }), 'Back in follow-ups')}>
      Reopen
    </button>
  )
}

export function CopyLink({ url, label = 'Copy link' }: { url: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          toast.success('Link copied')
        } catch {
          toast.error(url)
        }
      }}
    >
      <Copy /> {label}
    </button>
  )
}

// --- Announcements ---------------------------------------------------------

export function AnnouncementForm({ branches }: { branches: { id: string; name: string }[] }) {
  const blank: AnnouncementInput = { title: '', body: '', pinned: false, push: true, branchId: '' }
  const form = useForm<AnnouncementInput, unknown, AnnouncementOutput>({ resolver: zodResolver(announcementSchema), defaultValues: blank })
  const [until, setUntil] = useState('')
  const { run, pending } = useAction()
  const errors = form.formState.errors
  return (
    <form
      className="form-grid"
      onSubmit={form.handleSubmit(async (values) => {
        const done = await run(
          () => api<{ notified: number; pushed: number }>('/api/gym/announcements', { method: 'POST', body: { ...values, expiresAt: until ? istAt(until, '23:59') : undefined } }),
          (r) => (values.push ? `Sent to ${r.notified} members (${r.pushed} by push)` : 'Posted on the member app'),
        )
        if (done !== null) {
          form.reset(blank)
          setUntil('')
        }
      })}
    >
      <div className="field full">
        <label htmlFor="a-title">Title</label>
        <input id="a-title" placeholder="Gym closed on Diwali" {...form.register('title')} aria-invalid={Boolean(errors.title)} />
        {errors.title ? <span className="field-error">{errors.title.message}</span> : null}
      </div>
      <div className="field full">
        <label htmlFor="a-body">Message</label>
        <textarea id="a-body" rows={3} placeholder="We are closed on 1 Nov. Happy Diwali to you and your family!" {...form.register('body')} aria-invalid={Boolean(errors.body)} />
        {errors.body ? <span className="field-error">{errors.body.message}</span> : <span className="hint">Write it in the language most members read. It is not translated.</span>}
      </div>
      <div className="field">
        <label htmlFor="a-until">Show until (optional)</label>
        <input id="a-until" type="date" min={todayInput()} value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      {branches.length > 1 ? (
        <div className="field">
          <label htmlFor="a-branch">Who sees it</label>
          <select id="a-branch" {...form.register('branchId')}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} members</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="full check-line">
        <label><input type="checkbox" {...form.register('pinned')} /> Pin on top of the member home screen</label>
        <label><input type="checkbox" {...form.register('push')} /> Notify members now (bell + push, free)</label>
      </div>
      <div className="full">
        <button className="btn btn-dark" disabled={pending}>{pending ? <Loader2 className="spin" /> : <Megaphone />} Publish</button>
      </div>
    </form>
  )
}

export function EndAnnouncement({ id }: { id: string }) {
  const { run, pending } = useAction()
  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/announcements/${id}`, { method: 'DELETE' }), 'Taken down')}>
      <X /> Take down
    </button>
  )
}

// --- Challenges ------------------------------------------------------------

export function ChallengeForm() {
  const start = todayInput()
  const blank: ChallengeInput = { title: '', description: '', metric: 'visits', target: 20, startsAt: start, endsAt: todayInput(29), badge: true }
  const form = useForm<ChallengeInput, unknown, ChallengeOutput>({ resolver: zodResolver(challengeSchema), defaultValues: blank })
  const { run, pending } = useAction()
  const errors = form.formState.errors
  return (
    <form
      className="form-grid"
      onSubmit={form.handleSubmit(async () => {
        const raw = form.getValues()
        const body = { ...raw, startsAt: istAt(String(raw.startsAt), '00:00'), endsAt: istAt(String(raw.endsAt), '00:00') }
        const done = await run(() => api('/api/gym/challenges', { method: 'POST', body }), 'Challenge is live in the member app')
        if (done !== null) form.reset(blank)
      })}
    >
      <div className="field full">
        <label htmlFor="c-title">Name</label>
        <input id="c-title" placeholder="20 visits in November" {...form.register('title')} aria-invalid={Boolean(errors.title)} />
        {errors.title ? <span className="field-error">{errors.title.message}</span> : null}
      </div>
      <div className="field full">
        <label htmlFor="c-desc">Description</label>
        <input id="c-desc" placeholder="Finish 20 sessions this month and win the Challenge Champ badge" {...form.register('description')} />
      </div>
      <div className="field">
        <label htmlFor="c-metric">Count</label>
        <select id="c-metric" {...form.register('metric')}>
          <option value="visits">Days visited</option>
          <option value="streak">Longest streak (days)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="c-target">Target</label>
        <input id="c-target" type="number" min={1} max={366} {...form.register('target')} aria-invalid={Boolean(errors.target)} />
        {errors.target ? <span className="field-error">{errors.target.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="c-start">Starts</label>
        <input id="c-start" type="date" {...form.register('startsAt')} />
      </div>
      <div className="field">
        <label htmlFor="c-end">Ends</label>
        <input id="c-end" type="date" {...form.register('endsAt')} aria-invalid={Boolean(errors.endsAt)} />
        {errors.endsAt ? <span className="field-error">{errors.endsAt.message}</span> : null}
      </div>
      <div className="full check-line">
        <label><input type="checkbox" {...form.register('badge')} /> Finishers get the Challenge Champ badge</label>
      </div>
      <div className="full">
        <button className="btn btn-dark" disabled={pending}>{pending ? <Loader2 className="spin" /> : <Plus />} Start challenge</button>
      </div>
    </form>
  )
}

export function DeleteChallenge({ id }: { id: string }) {
  const { run, pending } = useAction()
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm('Delete this challenge and everyone\'s progress in it?')) void run(() => api(`/api/gym/challenges/${id}`, { method: 'DELETE' }), 'Challenge deleted')
      }}
    >
      <Trash2 /> Delete
    </button>
  )
}

// --- Complaints ------------------------------------------------------------

export function ComplaintActions({ id, status }: { id: string; status: string }) {
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')
  const { run, pending } = useAction()
  if (status === 'RESOLVED') {
    return (
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/complaints/${id}`, { method: 'PATCH', body: { status: 'OPEN', resolutionNote: '' } }), 'Reopened')}>
        Reopen
      </button>
    )
  }
  return (
    <div className="lead-actions">
      <div className="row-actions">
        {status === 'OPEN' ? (
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/complaints/${id}`, { method: 'PATCH', body: { status: 'IN_PROGRESS', resolutionNote: '' } }), 'Marked in progress')}>
            Working on it
          </button>
        ) : null}
        <button type="button" className={`btn btn-sm ${resolving ? 'btn-dark' : 'btn-lime'}`} onClick={() => setResolving((v) => !v)}>
          <Check /> Resolve
        </button>
      </div>
      {resolving ? (
        <form
          className="lead-panel"
          onSubmit={async (e) => {
            e.preventDefault()
            await run(() => api(`/api/gym/complaints/${id}`, { method: 'PATCH', body: { status: 'RESOLVED', resolutionNote: note } }), 'Resolved. The member has been told.')
          }}
        >
          <input value={note} maxLength={500} placeholder="Treadmill 2 belt replaced, ready to use" onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-dark btn-sm" disabled={pending || note.trim().length < 3}>Save</button>
        </form>
      ) : null}
    </div>
  )
}

// --- Expenses --------------------------------------------------------------

export function ExpenseForm({ branches }: { branches: { id: string; name: string }[] }) {
  const blank: ExpenseInput = { category: 'RENT', amountRupees: '' as unknown as number, spentOn: todayInput(), note: '', branchId: '' }
  const form = useForm<ExpenseInput, unknown, ExpenseOutput>({ resolver: zodResolver(expenseSchema), defaultValues: blank })
  const { run, pending } = useAction()
  const errors = form.formState.errors
  return (
    <form
      className="expense-form"
      onSubmit={form.handleSubmit(async (values) => {
        const raw = form.getValues()
        const done = await run(() => api('/api/gym/expenses', { method: 'POST', body: { ...values, spentOn: istAt(String(raw.spentOn), '12:00') } }), 'Expense added')
        if (done !== null) form.reset(blank)
      })}
    >
      <select {...form.register('category')} aria-label="Category">
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
        ))}
      </select>
      <input type="number" step="1" min="1" placeholder="Amount (Rs)" {...form.register('amountRupees')} aria-invalid={Boolean(errors.amountRupees)} aria-label="Amount in rupees" />
      <input type="date" max={todayInput()} {...form.register('spentOn')} aria-label="Date" />
      {branches.length > 1 ? (
        <select {...form.register('branchId')} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      ) : null}
      <input placeholder="Note (optional)" {...form.register('note')} />
      <button className="btn btn-dark btn-sm" disabled={pending}>{pending ? <Loader2 className="spin" /> : <Plus />} Add</button>
      {errors.amountRupees ? <span className="field-error">{errors.amountRupees.message}</span> : null}
    </form>
  )
}

export function DeleteExpense({ id }: { id: string }) {
  const { run, pending } = useAction()
  return (
    <button type="button" className="icon-btn" aria-label="Delete expense" disabled={pending} onClick={() => run(() => api(`/api/gym/expenses/${id}`, { method: 'DELETE' }), 'Expense removed')}>
      <Trash2 />
    </button>
  )
}

// --- AI insights -----------------------------------------------------------

export function InsightsPanel() {
  const [result, setResult] = useState<{ source: 'groq' | 'rules'; insights: string[] } | null>(null)
  const { run, pending } = useAction()
  return (
    <div className="insights">
      <button type="button" className="btn btn-dark" disabled={pending} onClick={async () => setResult(await run(() => api<{ source: 'groq' | 'rules'; insights: string[] }>('/api/gym/insights', { method: 'POST' }), 'Insights ready', { refresh: false }))}>
        {pending ? <Loader2 className="spin" /> : <Sparkles />} {result ? 'Refresh insights' : 'Get this week\'s insights'}
      </button>
      {result ? (
        <>
          <ul className="insight-list">
            {result.insights.map((line, i) => (
              <li key={i}><Sparkles /> <span>{line}</span></li>
            ))}
          </ul>
          <p className="hint">{result.source === 'groq' ? 'Written by AI from your numbers. Check before acting.' : 'Based on simple rules from your numbers (AI is not set up or was busy).'}</p>
        </>
      ) : null}
    </div>
  )
}
