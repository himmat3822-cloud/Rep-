'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Pencil, Plus, Save } from 'lucide-react'
import { api } from '@/lib/api/client'
import { membershipPlanSchema } from '@/lib/validation/owner'
import { useAction } from '@/components/admin/use-action'

type Input = z.input<typeof membershipPlanSchema>
type Output = z.output<typeof membershipPlanSchema>

export interface PlanRow {
  id: string
  name: string
  durationDays: number
  priceRupees: number
  joiningFeeRupees: number
  gstPercent: number
  gstInclusive: boolean
  maxFreezeDays: number
  crossBranch: boolean
  ptAddonRupees: number | ''
  ptSessionsIncluded: number
  active: boolean
  sortOrder: number
  sold: number
}

const EMPTY: Input = { name: '', durationDays: 30, priceRupees: 1500, joiningFeeRupees: 0, gstPercent: 18, gstInclusive: true, maxFreezeDays: 0, crossBranch: false, ptAddonRupees: '', ptSessionsIncluded: 0, active: true, sortOrder: 0 }

function PlanForm({ plan, onDone, multiBranch }: { plan?: PlanRow; onDone: () => void; multiBranch: boolean }) {
  const { run, pending } = useAction()
  const form = useForm<Input, unknown, Output>({ resolver: zodResolver(membershipPlanSchema), defaultValues: plan ? { ...plan } : EMPTY })
  const { errors } = form.formState
  async function submit(values: Output) {
    const result = await run(() => api(plan ? `/api/gym/plans/${plan.id}` : '/api/gym/plans', { method: plan ? 'PATCH' : 'POST', body: values }), plan ? 'Plan saved' : 'Plan created')
    if (result) onDone()
  }
  return (
    <form className="action-card" onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label>Name</label>
          <input {...form.register('name')} placeholder="Quarterly" />
          {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
        </div>
        <div className="field">
          <label>Duration (days)</label>
          <input type="number" {...form.register('durationDays')} />
        </div>
        <div className="field">
          <label>Price (Rs)</label>
          <input type="number" {...form.register('priceRupees')} />
        </div>
        <div className="field">
          <label>Joining fee (Rs, first plan only)</label>
          <input type="number" {...form.register('joiningFeeRupees')} />
        </div>
        <div className="field">
          <label>GST</label>
          <select {...form.register('gstPercent')}>
            <option value={18}>18%</option>
            <option value={12}>12%</option>
            <option value={5}>5%</option>
            <option value={0}>0% (not registered)</option>
          </select>
        </div>
        <div className="field">
          <label>Max freeze days</label>
          <input type="number" {...form.register('maxFreezeDays')} />
        </div>
        <div className="field">
          <label>PT add-on price (Rs, optional)</label>
          <input type="number" {...form.register('ptAddonRupees')} />
        </div>
        <div className="field">
          <label>PT sessions included</label>
          <input type="number" {...form.register('ptSessionsIncluded')} />
        </div>
        <label className="check-row">
          <input type="checkbox" {...form.register('gstInclusive')} /> Price includes GST
        </label>
        {multiBranch ? (
          <label className="check-row">
            <input type="checkbox" {...form.register('crossBranch')} /> Use any branch
          </label>
        ) : null}
        <label className="check-row">
          <input type="checkbox" {...form.register('active')} /> On sale
        </label>
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

export function PlanEditor({ plans, multiBranch }: { plans: PlanRow[]; multiBranch: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="kicker">WHAT YOU SELL</p>
          <h2>Membership plans</h2>
        </div>
        <button className="btn btn-lime" type="button" onClick={() => setEditing('new')}>
          <Plus /> New plan
        </button>
      </div>
      {editing === 'new' ? <PlanForm onDone={() => setEditing(null)} multiBranch={multiBranch} /> : null}
      <div className="list-rows">
        {plans.map((plan) =>
          editing === plan.id ? (
            <PlanForm key={plan.id} plan={plan} onDone={() => setEditing(null)} multiBranch={multiBranch} />
          ) : (
            <div className="list-row" key={plan.id}>
              <span>
                <strong>{plan.name}</strong> {!plan.active ? <span className="badge badge-grey">Not on sale</span> : null}
                <br />
                <small>
                  {plan.durationDays} days - Rs {plan.priceRupees.toLocaleString('en-IN')} {plan.gstInclusive ? 'incl.' : '+'} {plan.gstPercent}% GST
                  {plan.joiningFeeRupees ? ` - joining Rs ${plan.joiningFeeRupees}` : ''}
                  {plan.maxFreezeDays ? ` - ${plan.maxFreezeDays} freeze days` : ''}
                  {plan.crossBranch ? ' - all branches' : ''} - sold {plan.sold}
                </small>
              </span>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(plan.id)}>
                <Pencil /> Edit
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  )
}
