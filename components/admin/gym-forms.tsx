'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Save } from 'lucide-react'
import { api } from '@/lib/api/client'
import { overrideSchema, updateGymSchema } from '@/lib/validation/admin'
import { OverridePicker } from './feature-picker'
import { useAction } from './use-action'

// Edit gym profile + plan, and per-gym overrides.

type GymInput = z.input<typeof updateGymSchema>
type GymOutput = z.output<typeof updateGymSchema>

export function GymEditForm({ gymId, defaults, plans }: { gymId: string; defaults: GymInput; plans: { id: string; name: string; archived: boolean }[] }) {
  const { run, pending } = useAction()
  const form = useForm<GymInput, unknown, GymOutput>({ resolver: zodResolver(updateGymSchema), defaultValues: defaults })
  const { errors } = form.formState
  const err = (name: keyof GymInput) => (errors[name] ? <span className="field-error">{String(errors[name]?.message)}</span> : null)

  return (
    <form className="panel" onSubmit={form.handleSubmit((values) => run(() => api(`/api/admin/gyms/${gymId}`, { method: 'PATCH', body: values, session: 'admin' }), 'Gym updated'))} noValidate>
      <p className="kicker">PROFILE AND PLAN</p>
      <h2>Edit gym</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="g-name">Name</label>
          <input id="g-name" {...form.register('name')} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="g-slug">Link</label>
          <input id="g-slug" {...form.register('slug')} />
          <span className="hint">Changing it breaks old member links and installed apps.</span>
          {err('slug')}
        </div>
        <div className="field">
          <label htmlFor="g-city">City</label>
          <input id="g-city" {...form.register('city')} />
          {err('city')}
        </div>
        <div className="field">
          <label htmlFor="g-gst">GSTIN</label>
          <input id="g-gst" {...form.register('gstNumber')} placeholder="03ABCDE1234F1Z5" />
          {err('gstNumber')}
        </div>
        <div className="field full">
          <label htmlFor="g-address">Address</label>
          <input id="g-address" {...form.register('address')} />
        </div>
        <div className="field">
          <label htmlFor="g-plan">Rep+ plan</label>
          <select id="g-plan" {...form.register('planId')}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
                {plan.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
          <span className="hint">Applies from the next invoice.</span>
        </div>
        <div className="field">
          <label htmlFor="g-cycle">Cycle</label>
          <select id="g-cycle" {...form.register('cycle')}>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </select>
        </div>
        <label className="check-row full">
          <input type="checkbox" {...form.register('ownerHandlesDesk')} /> Owner handles front desk
        </label>
      </div>
      <div className="actions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save changes
        </button>
      </div>
    </form>
  )
}

type OverrideInput = z.input<typeof overrideSchema>
type OverrideOutput = z.output<typeof overrideSchema>

export function OverrideForm({ gymId, planFeatures, defaults }: { gymId: string; planFeatures: string[]; defaults: OverrideInput & { extraFeatures: string[]; removedFeatures: string[] } }) {
  const { run, pending } = useAction()
  const form = useForm<OverrideInput, unknown, OverrideOutput>({ resolver: zodResolver(overrideSchema), defaultValues: defaults })
  const [features, setFeatures] = useState({ extra: defaults.extraFeatures, removed: defaults.removedFeatures })

  return (
    <form
      className="panel"
      onSubmit={form.handleSubmit((values) =>
        run(() => api(`/api/admin/gyms/${gymId}/override`, { method: 'PUT', body: { ...values, extraFeatures: features.extra, removedFeatures: features.removed }, session: 'admin' }), 'Overrides saved'),
      )}
      noValidate
    >
      <p className="kicker">PER-GYM OVERRIDES</p>
      <h2>Custom deal</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="o-price">Custom price per cycle (Rs, excl. GST)</label>
          <input id="o-price" type="number" min={0} placeholder="Plan price" {...form.register('customPriceRupees')} />
          <span className="hint">Empty = use the plan price.</span>
        </div>
        <div className="field">
          <label htmlFor="o-wa">WhatsApp credit top-up (messages / month)</label>
          <input id="o-wa" type="number" min={0} {...form.register('whatsappTopUp')} />
        </div>
        <div className="field">
          <label htmlFor="o-members">Extra members</label>
          <input id="o-members" type="number" min={0} {...form.register('extraMembers')} />
        </div>
        <div className="field">
          <label htmlFor="o-branches">Extra branches (free)</label>
          <input id="o-branches" type="number" min={0} {...form.register('extraBranches')} />
        </div>
        <div className="field">
          <label htmlFor="o-staff">Extra staff</label>
          <input id="o-staff" type="number" min={0} {...form.register('extraStaff')} />
        </div>
        <div className="field">
          <label htmlFor="o-note">Internal note</label>
          <input id="o-note" {...form.register('note')} placeholder="e.g. Launch partner discount" />
        </div>
      </div>
      <label className="field" style={{ marginBottom: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>Features (click to cycle: plan default, grant, remove)</span>
      </label>
      <OverridePicker planFeatures={planFeatures} extra={features.extra} removed={features.removed} onChange={setFeatures} />
      <div className="actions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save overrides
        </button>
      </div>
    </form>
  )
}
