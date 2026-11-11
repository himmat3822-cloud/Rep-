'use client'

import { useMemo, useState } from 'react'
import { BadgeIndianRupee, Loader2, PauseCircle, Receipt, Snowflake } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'
import { formatInr } from '@/lib/money'

// Sell / renew a plan, collect dues and freeze - the counter actions for one member.

export interface PanelPlan {
  id: string
  name: string
  durationDays: number
  pricePaise: number
  joiningFeePaise: number
  gstPercent: number
  gstInclusive: boolean
  maxFreezeDays: number
}

export interface PanelDue {
  id: string
  amountPaise: number
  dueDate: string
}

const METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK', label: 'Bank' },
] as const

type Method = (typeof METHODS)[number]['value']

function MethodPicker({ value, onChange }: { value: Method; onChange: (value: Method) => void }) {
  return (
    <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      {METHODS.map((method) => (
        <label key={method.value} className={value === method.value ? 'on' : ''}>
          <input type="radio" checked={value === method.value} onChange={() => onChange(method.value)} />
          <strong>{method.label}</strong>
        </label>
      ))}
    </div>
  )
}

export function MoneyPanel({
  memberId,
  plans,
  dues,
  isFirstPlan,
  canCollect,
  canFreeze,
  canWaive,
  current,
  openSell,
}: {
  memberId: string
  plans: PanelPlan[]
  dues: PanelDue[]
  isFirstPlan: boolean
  canCollect: boolean
  canFreeze: boolean
  canWaive: boolean
  current: { id: string; endsAt: string; freezeLeft: number } | null
  openSell: boolean
}) {
  const { run, pending } = useAction()
  const [tab, setTab] = useState<'sell' | 'dues' | 'freeze'>(dues.length && !openSell ? 'dues' : 'sell')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [joining, setJoining] = useState(isFirstPlan)
  const [discount, setDiscount] = useState(0)
  const [method, setMethod] = useState<Method>('UPI')
  const plan = plans.find((item) => item.id === planId)
  const total = useMemo(() => {
    if (!plan) return 0
    const base = Math.max(0, plan.pricePaise + (joining ? plan.joiningFeePaise : 0) - Math.round(discount * 100))
    return plan.gstInclusive ? base : Math.round(base * (1 + plan.gstPercent / 100))
  }, [plan, joining, discount])
  const [paid, setPaid] = useState<string>('')
  const paidPaise = paid === '' ? total : Math.round(Number(paid) * 100)
  const [freezeDays, setFreezeDays] = useState(7)
  const [freezeFrom, setFreezeFrom] = useState(new Date().toISOString().slice(0, 10))
  const [freezeReason, setFreezeReason] = useState('')
  const [dueAmounts, setDueAmounts] = useState<Record<string, string>>({})

  async function sell() {
    if (!plan) return toast.error('Pick a plan')
    if (paidPaise > total) return toast.error('Amount paid is more than the total')
    const result = await run(
      () => api<{ invoiceNumber: string | null; duePaise: number; invoiceId: string | null }>(`/api/gym/members/${memberId}/memberships`, {
        method: 'POST',
        body: { planId: plan.id, discountRupees: discount, amountPaidRupees: paidPaise / 100, method, includeJoiningFee: joining },
      }),
      (r) => (r.invoiceNumber ? `Plan added. Invoice ${r.invoiceNumber}${r.duePaise ? `, ${formatInr(r.duePaise)} still due` : ''}` : 'Plan added as due'),
    )
    if (result?.invoiceId) window.open(`/api/gym/invoices/${result.invoiceId}/pdf`, '_blank', 'noopener')
    if (result) setPaid('')
  }

  async function collect(due: PanelDue) {
    const raw = dueAmounts[due.id]
    const amount = raw ? Number(raw) : undefined
    const result = await run(
      () => api<{ invoiceNumber: string; invoiceId: string; remainingPaise: number }>(`/api/gym/dues/${due.id}/collect`, { method: 'POST', body: { amountRupees: amount, method } }),
      (r) => `Collected. Invoice ${r.invoiceNumber}${r.remainingPaise ? `, ${formatInr(r.remainingPaise)} left` : ''}`,
    )
    if (result) window.open(`/api/gym/invoices/${result.invoiceId}/pdf`, '_blank', 'noopener')
  }

  async function waive(due: PanelDue) {
    const reason = window.prompt('Why are you waiving this due? (saved in the audit log)')
    if (!reason || reason.trim().length < 5) return toast.error('A short reason is needed to waive')
    await run(() => api(`/api/gym/dues/${due.id}/waive`, { method: 'POST', body: { reason } }), 'Due waived')
  }

  async function freeze() {
    if (!current) return
    await run(() => api<{ endsAt: string }>(`/api/gym/members/${memberId}/freeze`, { method: 'POST', body: { membershipId: current.id, fromDate: freezeFrom, days: freezeDays, reason: freezeReason } }), (r) => `Frozen. New end date ${new Date(r.endsAt).toLocaleDateString('en-IN')}`)
  }

  return (
    <section className="panel">
      <div className="tab-links" style={{ marginBottom: 14 }}>
        {canCollect ? (
          <a className={tab === 'sell' ? 'active' : ''} onClick={() => setTab('sell')} role="button">
            {isFirstPlan ? 'Sell plan' : 'Renew'}
          </a>
        ) : null}
        <a className={tab === 'dues' ? 'active' : ''} onClick={() => setTab('dues')} role="button">
          Dues {dues.length ? `(${dues.length})` : ''}
        </a>
        {canFreeze && current ? (
          <a className={tab === 'freeze' ? 'active' : ''} onClick={() => setTab('freeze')} role="button">
            Freeze
          </a>
        ) : null}
      </div>

      {tab === 'sell' && canCollect ? (
        plans.length === 0 ? (
          <p className="muted">Create a membership plan first (Membership plans in the menu).</p>
        ) : (
          <>
            <div className="radio-cards">
              {plans.map((item) => (
                <label key={item.id} className={item.id === planId ? 'on' : ''}>
                  <input type="radio" checked={item.id === planId} onChange={() => setPlanId(item.id)} />
                  <strong>{item.name}</strong>
                  <span>{formatInr(item.pricePaise)}</span>
                  <small>
                    {item.durationDays} days{item.gstInclusive ? ' incl. GST' : ` + ${item.gstPercent}% GST`}
                  </small>
                </label>
              ))}
            </div>
            <div className="form-grid" style={{ marginTop: 0 }}>
              <div className="field">
                <label htmlFor="discount">Discount (Rs)</label>
                <input id="discount" type="number" min={0} value={discount} onChange={(event) => setDiscount(Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <label htmlFor="paid">Amount received now (Rs)</label>
                <input id="paid" type="number" min={0} placeholder={String(total / 100)} value={paid} onChange={(event) => setPaid(event.target.value)} />
                <span className="hint">Less than total = the rest becomes a due.</span>
              </div>
            </div>
            {plan && plan.joiningFeePaise > 0 ? (
              <label className="check-row">
                <input type="checkbox" checked={joining} onChange={(event) => setJoining(event.target.checked)} /> Add joining fee ({formatInr(plan.joiningFeePaise)})
              </label>
            ) : null}
            <MethodPicker value={method} onChange={setMethod} />
            <div className="price-preview">
              <div>
                <span>Total</span>
                <strong>{formatInr(total)}</strong>
              </div>
              <div>
                <span>Paying now ({method.toLowerCase()})</span>
                <span>{formatInr(Math.min(paidPaise, total))}</span>
              </div>
              {paidPaise < total ? (
                <div>
                  <span>Due in 7 days</span>
                  <span>{formatInr(total - paidPaise)}</span>
                </div>
              ) : null}
            </div>
            <button className="btn btn-lime" type="button" disabled={pending} onClick={sell}>
              {pending ? <Loader2 className="animate-spin" /> : <BadgeIndianRupee />} Confirm and issue invoice
            </button>
          </>
        )
      ) : null}

      {tab === 'dues' ? (
        dues.length === 0 ? (
          <p className="muted">No dues. All clear.</p>
        ) : (
          <>
            <MethodPicker value={method} onChange={setMethod} />
            <div className="list-rows">
              {dues.map((due) => (
                <div className="list-row" key={due.id}>
                  <span>
                    <strong>{formatInr(due.amountPaise)}</strong>
                    <br />
                    <small>due {new Date(due.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
                  </span>
                  <span className="toolbar">
                    {canCollect ? (
                      <>
                        <input style={{ width: 110, minWidth: 0 }} type="number" placeholder="Full amount" value={dueAmounts[due.id] ?? ''} onChange={(event) => setDueAmounts({ ...dueAmounts, [due.id]: event.target.value })} />
                        <button className="btn btn-dark btn-sm" type="button" disabled={pending} onClick={() => collect(due)}>
                          <Receipt /> Collect
                        </button>
                      </>
                    ) : null}
                    {canWaive ? (
                      <button className="btn btn-outline btn-sm" type="button" disabled={pending} onClick={() => waive(due)}>
                        Waive
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </>
        )
      ) : null}

      {tab === 'freeze' && current ? (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            {current.freezeLeft > 0 ? `${current.freezeLeft} freeze day(s) left on this plan. The end date moves forward by the same number of days.` : 'This plan has no freeze days left.'}
          </p>
          <div className="form-grid" style={{ marginTop: 0 }}>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" type="date" value={freezeFrom} onChange={(event) => setFreezeFrom(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-days">Days</label>
              <input id="f-days" type="number" min={1} max={current.freezeLeft || 1} value={freezeDays} onChange={(event) => setFreezeDays(Number(event.target.value))} />
            </div>
            <div className="field full">
              <label htmlFor="f-reason">Reason</label>
              <input id="f-reason" placeholder="Travel, injury, exams" value={freezeReason} onChange={(event) => setFreezeReason(event.target.value)} />
            </div>
          </div>
          <button className="btn btn-dark" type="button" disabled={pending || current.freezeLeft <= 0} onClick={freeze}>
            {pending ? <Loader2 className="animate-spin" /> : <Snowflake />} Freeze plan
          </button>
        </>
      ) : null}
      {!canCollect && tab === 'sell' ? (
        <p className="muted">
          <PauseCircle size={14} /> You do not have permission to collect payments.
        </p>
      ) : null}
    </section>
  )
}
