'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Archive, ArchiveRestore, Loader2, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { planSchema } from '@/lib/validation/admin'
import { FeaturePicker } from './feature-picker'
import { useAction } from './use-action'

type Input = z.input<typeof planSchema>
type Output = z.output<typeof planSchema>

export function PlanForm({ planId, defaults, archived = false, subscribers = 0 }: { planId?: string; defaults: Input & { features: string[] }; archived?: boolean; subscribers?: number }) {
  const { run, pending, router } = useAction()
  const form = useForm<Input, unknown, Output>({ resolver: zodResolver(planSchema), defaultValues: defaults })
  const [features, setFeatures] = useState<string[]>(defaults.features)
  const { errors } = form.formState
  const err = (name: keyof Input) => (errors[name] ? <span className="field-error">{String(errors[name]?.message)}</span> : null)

  async function submit(values: Output) {
    const body = { ...values, features }
    if (planId) {
      const { code: _code, ...rest } = body
      void _code
      await run(() => api(`/api/admin/plans/${planId}`, { method: 'PATCH', body: rest, session: 'admin' }), 'Plan saved')
      return
    }
    const created = await run(() => api<{ id: string }>('/api/admin/plans', { method: 'POST', body, session: 'admin' }), 'Plan created', { refresh: false })
    if (created) router.push('/admin/plans')
  }

  async function toggleArchive() {
    if (!planId) return
    const values = form.getValues()
    const parsed = planSchema.safeParse({ ...values, features })
    if (!parsed.success) return
    const { code: _code, ...rest } = parsed.data
    void _code
    await run(() => api(`/api/admin/plans/${planId}`, { method: 'PATCH', body: { ...rest, archived: !archived }, session: 'admin' }), archived ? 'Plan is available again' : 'Plan archived - current gyms keep it')
  }

  async function remove() {
    if (!planId) return
    if (!window.confirm(subscribers > 0 ? `${subscribers} gym(s) use this plan, so it will be archived instead of deleted. Continue?` : 'Delete this plan permanently?')) return
    const result = await run(() => api<{ deleted: boolean }>(`/api/admin/plans/${planId}`, { method: 'DELETE', session: 'admin' }), (r) => (r.deleted ? 'Plan deleted' : 'Plan archived (still has subscribers)'), { refresh: false })
    if (result) {
      router.push('/admin/plans')
      router.refresh()
    }
  }

  return (
    <form className="panel" onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-name">Plan name</label>
          <input id="p-name" {...form.register('name')} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="p-code">Code</label>
          <input id="p-code" {...form.register('code')} disabled={Boolean(planId)} />
          <span className="hint">Permanent id used in billing. Cannot change later.</span>
          {err('code')}
        </div>
        <div className="field full">
          <label htmlFor="p-desc">Description (shown on pricing)</label>
          <input id="p-desc" {...form.register('description')} />
        </div>
        <div className="field">
          <label htmlFor="p-monthly">Monthly price (Rs, excl. GST)</label>
          <input id="p-monthly" type="number" min={0} {...form.register('monthlyPriceRupees')} />
          {err('monthlyPriceRupees')}
        </div>
        <div className="field">
          <label htmlFor="p-annual">Annual price (Rs, excl. GST)</label>
          <input id="p-annual" type="number" min={0} {...form.register('annualPriceRupees')} />
          <button type="button" className="link-button" style={{ alignSelf: 'flex-start' }} onClick={() => form.setValue('annualPriceRupees', Number(form.getValues('monthlyPriceRupees') || 0) * 10)}>
            Set to 10 x monthly
          </button>
          {err('annualPriceRupees')}
        </div>
        <div className="field">
          <label htmlFor="p-members">Member limit</label>
          <input id="p-members" type="number" min={0} placeholder="Unlimited" {...form.register('memberLimit')} />
        </div>
        <div className="field">
          <label htmlFor="p-branches">Branch limit</label>
          <input id="p-branches" type="number" min={1} {...form.register('branchLimit')} />
          {err('branchLimit')}
        </div>
        <div className="field">
          <label htmlFor="p-extra">Price per extra branch (Rs / month)</label>
          <input id="p-extra" type="number" min={0} placeholder="Not allowed" {...form.register('extraBranchRupees')} />
        </div>
        <div className="field">
          <label htmlFor="p-wa">WhatsApp messages / month</label>
          <input id="p-wa" type="number" min={0} {...form.register('whatsappQuota')} />
          {err('whatsappQuota')}
        </div>
        <div className="field">
          <label htmlFor="p-staff">Total staff limit</label>
          <input id="p-staff" type="number" min={0} placeholder="Unlimited" {...form.register('staffLimit')} />
        </div>
        <div className="field">
          <label htmlFor="p-trainers">Trainers / desk limit</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="p-trainers" type="number" min={0} placeholder="Trainers" {...form.register('trainerLimit')} />
            <input type="number" min={0} placeholder="Desk" aria-label="Desk staff limit" {...form.register('deskLimit')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-order">Sort order</label>
          <input id="p-order" type="number" min={0} {...form.register('sortOrder')} />
        </div>
        <label className="check-row" style={{ alignSelf: 'center' }}>
          <input type="checkbox" {...form.register('isPopular')} /> Mark as most popular
        </label>
      </div>

      <p className="kicker" style={{ marginTop: 6 }}>FEATURES IN THIS PLAN ({features.length})</p>
      <FeaturePicker value={features} onChange={setFeatures} />

      <div className="actions">
        <button className="btn btn-dark" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {planId ? 'Save plan' : 'Create plan'}
        </button>
        {planId ? (
          <>
            <button className="btn btn-outline" type="button" disabled={pending} onClick={toggleArchive}>
              {archived ? <ArchiveRestore /> : <Archive />} {archived ? 'Unarchive' : 'Archive'}
            </button>
            <button className="btn btn-danger" type="button" disabled={pending} onClick={remove}>
              <Trash2 /> Delete
            </button>
          </>
        ) : null}
      </div>
    </form>
  )
}
