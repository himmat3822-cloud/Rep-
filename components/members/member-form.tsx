'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Save, UserPlus } from 'lucide-react'
import { api } from '@/lib/api/client'
import { memberSchema } from '@/lib/validation/owner'
import { useAction } from '@/components/admin/use-action'

type Input = z.input<typeof memberSchema>
type Output = z.output<typeof memberSchema>

export interface MemberFormOptions {
  branches: { id: string; name: string }[]
  trainers: { id: string; name: string }[]
  label: string
}

// Add (quick or full) and edit a member. After adding, it jumps to the
// member's page with the "sell plan" panel open.
export function MemberForm({ mode, memberId, defaults, options, base, compact = false }: { mode: 'create' | 'edit'; memberId?: string; defaults?: Partial<Input>; options: MemberFormOptions; base: string; compact?: boolean }) {
  const { run, pending, router } = useAction()
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(memberSchema),
    defaultValues: { name: '', phone: '', email: '', gender: '', dateOfBirth: '', homeBranchId: options.branches[0]?.id ?? '', trainerId: '', language: 'EN', emergencyContact: '', medicalNotes: '', notes: '', referralCode: '', biometricId: '', ...defaults } as Input,
  })
  const { errors } = form.formState
  const err = (name: keyof Input) => (errors[name] ? <span className="field-error">{String(errors[name]?.message)}</span> : null)

  async function submit(values: Output) {
    if (mode === 'edit' && memberId) {
      await run(() => api(`/api/gym/members/${memberId}`, { method: 'PATCH', body: values }), 'Details saved')
      return
    }
    const created = await run(() => api<{ id: string; memberCode: string }>('/api/gym/members', { method: 'POST', body: values }), (r) => `${values.name} added (${r.memberCode})`, { refresh: false })
    if (created) router.push(`${base}/members/${created.id}?sell=1`)
  }

  return (
    <form className="panel" onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <div className="field">
          <label htmlFor="m-name">Full name</label>
          <input id="m-name" autoFocus={mode === 'create'} {...form.register('name')} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="m-phone">WhatsApp number</label>
          <div className="phone-input">
            <span>+91</span>
            <input id="m-phone" inputMode="numeric" {...form.register('phone')} />
          </div>
          {err('phone')}
        </div>
        <div className="field">
          <label htmlFor="m-branch">Home branch</label>
          <select id="m-branch" {...form.register('homeBranchId')}>
            {options.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-lang">App language</label>
          <select id="m-lang" {...form.register('language')}>
            <option value="EN">English</option>
            <option value="HI">Hindi</option>
            <option value="PA">Punjabi</option>
          </select>
        </div>
        {!compact ? (
          <>
            <div className="field">
              <label htmlFor="m-trainer">Trainer</label>
              <select id="m-trainer" {...form.register('trainerId')}>
                <option value="">No trainer</option>
                {options.trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="m-gender">Gender</label>
              <select id="m-gender" {...form.register('gender')}>
                <option value="">Prefer not to say</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="O">Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="m-dob">Date of birth (for birthday wishes)</label>
              <input id="m-dob" type="date" {...form.register('dateOfBirth')} />
            </div>
            <div className="field">
              <label htmlFor="m-email">Email</label>
              <input id="m-email" type="email" {...form.register('email')} />
              {err('email')}
            </div>
            <div className="field">
              <label htmlFor="m-emergency">Emergency contact (encrypted)</label>
              <input id="m-emergency" placeholder="Name and number" {...form.register('emergencyContact')} />
            </div>
            <div className="field">
              <label htmlFor="m-medical">Medical notes (encrypted)</label>
              <input id="m-medical" placeholder="Injuries, conditions" {...form.register('medicalNotes')} />
            </div>
            <div className="field">
              <label htmlFor="m-bio">Biometric / card ID (optional)</label>
              <input id="m-bio" placeholder="Enrolment number on the machine" {...form.register('biometricId')} />
              {err('biometricId')}
            </div>
            <div className="field full">
              <label htmlFor="m-notes">Internal notes</label>
              <textarea id="m-notes" {...form.register('notes')} />
            </div>
          </>
        ) : null}
        {mode === 'create' ? (
          <div className="field">
            <label htmlFor="m-ref">Referral code (optional)</label>
            <input id="m-ref" placeholder="Friend's code" {...form.register('referralCode')} />
          </div>
        ) : null}
      </div>
      <div className="actions">
        <button className="btn btn-lime" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : mode === 'create' ? <UserPlus /> : <Save />}
          {mode === 'create' ? `Add ${options.label.toLowerCase()} and sell a plan` : 'Save details'}
        </button>
      </div>
    </form>
  )
}
