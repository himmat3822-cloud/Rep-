'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Check, Loader2, Send } from 'lucide-react'
import { api } from '@/lib/api/client'
import { billingClaimSchema } from '@/lib/validation/owner'
import { useAction } from '@/components/admin/use-action'
import { formatInr } from '@/lib/money'

type ClaimInput = z.input<typeof billingClaimSchema>
type ClaimOutput = z.output<typeof billingClaimSchema>

export function PaymentClaimForm({ amountRupees, disabled }: { amountRupees: number; disabled: boolean }) {
  const { run, pending } = useAction()
  const form = useForm<ClaimInput, unknown, ClaimOutput>({ resolver: zodResolver(billingClaimSchema), defaultValues: { amountRupees, method: 'UPI', reference: '', note: '' } })
  const { errors } = form.formState
  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        const result = await run(() => api('/api/gym/billing/claim', { method: 'POST', body: values }), 'Thanks! We will verify and confirm on WhatsApp shortly.')
        if (result) form.reset({ ...values, reference: '', note: '' })
      })}
      noValidate
    >
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label htmlFor="c-amount">Amount paid (Rs)</label>
          <input id="c-amount" type="number" step="0.01" {...form.register('amountRupees')} />
          {errors.amountRupees ? <span className="field-error">{errors.amountRupees.message}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="c-method">Paid by</label>
          <select id="c-method" {...form.register('method')}>
            <option value="UPI">UPI</option>
            <option value="BANK">Bank transfer (NEFT / IMPS)</option>
          </select>
        </div>
        <div className="field full">
          <label htmlFor="c-ref">UTR / transaction ID</label>
          <input id="c-ref" placeholder="12-digit UPI reference" {...form.register('reference')} />
          {errors.reference ? <span className="field-error">{errors.reference.message}</span> : null}
        </div>
      </div>
      <button className="btn btn-lime" type="submit" disabled={pending || disabled}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} I have paid - verify it
      </button>
    </form>
  )
}

export interface PlanChoice {
  id: string
  name: string
  monthlyPaise: number
  annualPaise: number
  memberLimit: number | null
  branchLimit: number
  isPopular: boolean
}

export function PlanSwitcher({ plans, currentPlanId, currentCycle }: { plans: PlanChoice[]; currentPlanId: string; currentCycle: 'MONTHLY' | 'ANNUAL' }) {
  const { run, pending } = useAction()
  const [cycle, setCycle] = useState(currentCycle)
  return (
    <div>
      <div className="lang-toggle" style={{ marginBottom: 12 }}>
        <button type="button" className={cycle === 'MONTHLY' ? 'active' : ''} onClick={() => setCycle('MONTHLY')}>
          Monthly
        </button>
        <button type="button" className={cycle === 'ANNUAL' ? 'active' : ''} onClick={() => setCycle('ANNUAL')}>
          Annual (2 months free)
        </button>
      </div>
      <div className="list-rows">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId && cycle === currentCycle
          return (
            <div className="list-row" key={plan.id}>
              <span>
                <strong>{plan.name}</strong> {plan.isPopular ? <span className="price-tag">Most popular</span> : null}
                <br />
                <small>
                  {formatInr(cycle === 'ANNUAL' ? plan.annualPaise : plan.monthlyPaise)} / {cycle === 'ANNUAL' ? 'year' : 'month'} + GST - {plan.memberLimit ?? 'unlimited'} members, {plan.branchLimit} branch(es)
                </small>
              </span>
              {isCurrent ? (
                <span className="badge badge-lime">
                  <Check size={11} /> Current
                </span>
              ) : (
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Switch to ${plan.name} (${cycle.toLowerCase()})? The new price applies from your next payment.`)) {
                      void run(() => api('/api/gym/billing/plan', { method: 'POST', body: { planId: plan.id, cycle } }), `Switched to ${plan.name}`)
                    }
                  }}
                >
                  Switch
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
