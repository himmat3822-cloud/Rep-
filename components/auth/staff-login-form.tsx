'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/api/client'
import type { GymChoice, LoginResponse } from '@/lib/api/types'
import { passwordLoginSchema, safeNextPath } from '@/lib/validation/auth'
import { OtpFlow } from './otp-flow'

const emailForm = passwordLoginSchema.pick({ email: true, password: true })

export function StaffLoginForm({ next }: { next?: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<'phone' | 'email'>('phone')
  const [choices, setChoices] = useState<GymChoice[] | null>(null)
  const form = useForm<z.input<typeof emailForm>, unknown, z.output<typeof emailForm>>({ resolver: zodResolver(emailForm), defaultValues: { email: '', password: '' } })

  function done(result: LoginResponse) {
    toast.success(`Welcome, ${result.user.name.split(' ')[0]}`)
    router.replace(safeNextPath(next, result.redirectTo))
    router.refresh()
  }

  async function login(values: z.output<typeof emailForm>, gymSlug?: string) {
    try {
      done(await api<LoginResponse>('/api/auth/login', { method: 'POST', body: { ...values, gymSlug } }))
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'GYM_SELECTION_REQUIRED') {
        setChoices((error.details as { gyms?: GymChoice[] } | undefined)?.gyms ?? [])
        return
      }
      toast.error(error instanceof ApiClientError ? error.message : 'Could not log in. Try again.')
    }
  }

  return (
    <>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'phone'} className={tab === 'phone' ? 'active' : ''} onClick={() => setTab('phone')}>
          WhatsApp OTP
        </button>
        <button type="button" role="tab" aria-selected={tab === 'email'} className={tab === 'email' ? 'active' : ''} onClick={() => setTab('email')}>
          Email and password
        </button>
      </div>

      {tab === 'phone' ? (
        <OtpFlow scope="staff" onSuccess={done} />
      ) : choices ? (
        <div className="gym-choice">
          {choices.map((gym) => (
            <button key={gym.slug} type="button" onClick={() => login(form.getValues() as z.output<typeof emailForm>, gym.slug)}>
              <span>
                <strong>{gym.name}</strong>
                <br />
                <small>{gym.city}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={form.handleSubmit((values) => login(values))} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" placeholder="you@yourgym.in" aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
            {form.formState.errors.email ? <span className="field-error">{form.formState.errors.email.message}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
            {form.formState.errors.password ? <span className="field-error">{form.formState.errors.password.message}</span> : null}
          </div>
          <Button type="submit" className="lime-button auth-submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            Log in
          </Button>
        </form>
      )}
    </>
  )
}
