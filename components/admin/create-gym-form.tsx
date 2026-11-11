'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { createGymSchema } from '@/lib/validation/admin'
import { useAction } from './use-action'

type Input = z.input<typeof createGymSchema>
type Output = z.output<typeof createGymSchema>

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function CreateGymForm({ plans }: { plans: { id: string; name: string; monthly: string }[] }) {
  const { run, pending, router } = useAction()
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(createGymSchema),
    defaultValues: { name: '', slug: '', city: 'Mohali', address: '', ownerName: '', ownerPhone: '', ownerEmail: '', ownerPassword: '', planId: plans[0]?.id ?? '', cycle: 'MONTHLY', trialDays: 14, ownerHandlesDesk: true },
  })
  const { errors } = form.formState

  async function submit(values: Output) {
    const result = await run(() => api<{ id: string }>('/api/admin/gyms', { method: 'POST', body: values, session: 'admin' }), `${values.name} created with a ${values.trialDays}-day trial`, { refresh: false })
    if (result) router.push(`/admin/gyms/${result.id}`)
  }

  const err = (name: keyof Input) => (errors[name] ? <span className="field-error">{String(errors[name]?.message)}</span> : null)

  return (
    <form className="panel" onSubmit={form.handleSubmit(submit)} noValidate>
      <p className="kicker">GYM</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="name">Gym name</label>
          <input
            id="name"
            {...form.register('name', {
              onChange: (event: { target: { value: string } }) => {
                if (!form.formState.dirtyFields.slug) form.setValue('slug', slugify(event.target.value))
              },
            })}
          />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="slug">Gym link</label>
          <input id="slug" {...form.register('slug')} />
          <span className="hint">kasrat.app/g/{form.watch('slug') || 'your-gym'}</span>
          {err('slug')}
        </div>
        <div className="field">
          <label htmlFor="city">City</label>
          <select id="city" {...form.register('city')}>
            {['Mohali', 'Chandigarh', 'Zirakpur', 'Panchkula', 'Kharar', 'Other'].map((city) => (
              <option key={city}>{city}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="address">Address</label>
          <input id="address" {...form.register('address')} />
        </div>
      </div>

      <p className="kicker" style={{ marginTop: 10 }}>OWNER</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ownerName">Owner name</label>
          <input id="ownerName" {...form.register('ownerName')} />
          {err('ownerName')}
        </div>
        <div className="field">
          <label htmlFor="ownerPhone">Owner WhatsApp number</label>
          <div className="phone-input">
            <span>+91</span>
            <input id="ownerPhone" inputMode="numeric" {...form.register('ownerPhone')} />
          </div>
          {err('ownerPhone')}
        </div>
        <div className="field">
          <label htmlFor="ownerEmail">Owner email (optional)</label>
          <input id="ownerEmail" type="email" {...form.register('ownerEmail')} />
          {err('ownerEmail')}
        </div>
        <div className="field">
          <label htmlFor="ownerPassword">Password (optional)</label>
          <input id="ownerPassword" type="password" autoComplete="new-password" {...form.register('ownerPassword')} />
          <span className="hint">Leave empty: the owner logs in with WhatsApp OTP.</span>
          {err('ownerPassword')}
        </div>
      </div>

      <p className="kicker" style={{ marginTop: 10 }}>KASRAT PLAN</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="planId">Plan</label>
          <select id="planId" {...form.register('planId')}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} - {plan.monthly}/mo
              </option>
            ))}
          </select>
          {err('planId')}
        </div>
        <div className="field">
          <label htmlFor="cycle">Billing cycle</label>
          <select id="cycle" {...form.register('cycle')}>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual (10 months price)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="trialDays">Trial days</label>
          <input id="trialDays" type="number" min={0} max={90} {...form.register('trialDays')} />
          {err('trialDays')}
        </div>
        <label className="check-row" style={{ alignSelf: 'center' }}>
          <input type="checkbox" {...form.register('ownerHandlesDesk')} /> Owner also manages the reception
        </label>
      </div>

      <div className="actions">
        <button className="btn btn-lime" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Create gym
        </button>
      </div>
    </form>
  )
}
