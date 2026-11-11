'use client'

import { useState } from 'react'
import { Eye, Gift, Loader2, PauseCircle, PencilLine, PlayCircle, Receipt, Timer, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAction } from './use-action'

// Billing control, revoke/restore and impersonation for one gym.
// Every action requires a reason, which lands in the audit log.

type Status = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED'

function needReason(reason: string): boolean {
  if (reason.trim().length >= 5) return true
  toast.error('Write a short reason first (5+ characters). It goes into the audit log.')
  return false
}

export function GymActions({ gymId, gymName, status }: { gymId: string; gymName: string; status: Status }) {
  const { run, pending, router } = useAction()
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')

  const statusCall = (body: Record<string, unknown>, message: string) => {
    if (!needReason(reason)) return
    void run(() => api<{ from: string; to: string }>(`/api/admin/gyms/${gymId}/status`, { method: 'POST', body: { ...body, reason }, session: 'admin' }), (result) => `${message} (${result.from} -> ${result.to})`).then((result) => {
      if (result) setReason('')
    })
  }

  async function impersonate(mode: 'read' | 'write') {
    if (!needReason(reason)) return
    if (mode === 'write' && !window.confirm(`Open ${gymName} as the owner with WRITE access? Every change is logged.`)) return
    const result = await run(() => api<{ redirectTo: string }>(`/api/admin/gyms/${gymId}/impersonate`, { method: 'POST', body: { mode, reason }, session: 'admin' }), `Viewing ${gymName} as owner`, { refresh: false })
    if (result) router.push(result.redirectTo)
  }

  async function recordPayment() {
    const value = Number(amount)
    if (!value || value <= 0) {
      toast.error('Enter the amount received (incl. GST)')
      return
    }
    if (reference.trim().length < 3) {
      toast.error('Add a reference such as the UTR or cheque number')
      return
    }
    const result = await run(() => api<{ invoiceNumber: string }>(`/api/admin/gyms/${gymId}/payments`, { method: 'POST', body: { amountRupees: value, reference }, session: 'admin' }), (r) => `Payment recorded, invoice ${r.invoiceNumber}`)
    if (result) {
      setAmount('')
      setReference('')
    }
  }

  const suspended = status === 'SUSPENDED' || status === 'CANCELLED'
  const unpaid = status === 'PAST_DUE' || status === 'READ_ONLY'

  return (
    <section className="panel">
      <p className="kicker">CONTROL</p>
      <h2>Billing and access</h2>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="reason">
          <PencilLine size={12} /> Reason (required for every action, saved to the audit log)
        </label>
        <input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Paid by bank transfer, owner asked for more time" />
      </div>

      <div className={`action-card ${suspended ? '' : 'danger-zone'}`}>
        <h3>{suspended ? 'Restore access' : 'Revoke access'}</h3>
        <p>
          {suspended
            ? 'Turns the gym back on instantly. If it is still unpaid it stays on until it pays or you revoke again.'
            : 'Suspends the gym immediately. Staff only see the billing page and members see a paused message. Data is kept for 90 days.'}
        </p>
        <div className="inline">
          {suspended ? (
            <button className="btn btn-lime" type="button" disabled={pending} onClick={() => statusCall({ action: 'restore' }, 'Gym restored')}>
              {pending ? <Loader2 className="animate-spin" /> : <PlayCircle />} Restore
            </button>
          ) : (
            <button
              className="btn btn-danger"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Suspend ${gymName} right now?`)) statusCall({ action: 'suspend' }, 'Gym suspended')
              }}
            >
              <PauseCircle /> Revoke (suspend)
            </button>
          )}
          {unpaid ? (
            <button className="btn btn-outline" type="button" disabled={pending} onClick={() => statusCall({ action: 'restore' }, 'Goodwill access granted')}>
              <PlayCircle /> Restore without payment
            </button>
          ) : null}
          {status !== 'CANCELLED' ? (
            <button
              className="btn btn-outline"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Cancel ${gymName}'s Rep+ subscription? Data is kept for 90 days.`)) statusCall({ action: 'cancel' }, 'Subscription cancelled')
              }}
            >
              <XCircle /> Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="action-card">
        <h3>Trial and free months</h3>
        <p>Extending the trial puts the gym back on TRIAL. Free months are used up automatically on each due date, and they restore an unpaid gym straight away.</p>
        <div className="inline">
          <input type="number" min={1} max={90} value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ width: 80 }} aria-label="Days" />
          <button className="btn btn-outline" type="button" disabled={pending} onClick={() => statusCall({ action: 'extend_trial', days }, `Trial extended by ${days} days`)}>
            <Timer /> Extend trial
          </button>
          <input type="number" min={1} max={12} value={months} onChange={(event) => setMonths(Number(event.target.value))} style={{ width: 70 }} aria-label="Months" />
          <button className="btn btn-outline" type="button" disabled={pending} onClick={() => statusCall({ action: 'free_months', months }, `${months} free month(s) added`)}>
            <Gift /> Give free months
          </button>
        </div>
      </div>

      <div className="action-card">
        <h3>Record offline payment</h3>
        <p>For bank transfers or cheques. Enter the total received including GST. This issues a Rep+ invoice and restores the gym. Razorpay payments are recorded automatically by the webhook.</p>
        <div className="inline">
          <input type="number" min={1} placeholder="Amount in Rs" value={amount} onChange={(event) => setAmount(event.target.value)} style={{ width: 130 }} />
          <input className="grow" placeholder="UTR / cheque no." value={reference} onChange={(event) => setReference(event.target.value)} />
          <button className="btn btn-dark" type="button" disabled={pending} onClick={recordPayment}>
            <Receipt /> Record payment
          </button>
        </div>
      </div>

      <div className="action-card">
        <h3>Impersonate owner</h3>
        <p>Opens the owner dashboard for 30 minutes so you can help with support. Read-only by default. Every start, stop and write is logged.</p>
        <div className="inline">
          <button className="btn btn-dark" type="button" disabled={pending} onClick={() => impersonate('read')}>
            <Eye /> View as owner (read-only)
          </button>
          <button className="btn btn-outline" type="button" disabled={pending} onClick={() => impersonate('write')}>
            With write access
          </button>
        </div>
      </div>
    </section>
  )
}
