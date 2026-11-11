'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/api/client'
import type { GymChoice, LoginResponse, OtpRequestResponse } from '@/lib/api/types'
import { otpCodeSchema, phoneSchema } from '@/lib/validation/auth'

// Shared two-step WhatsApp OTP form: phone -> 6-digit code.
// Used by staff login (/login) and athlete login (/g/{slug}/login).

const phoneForm = z.object({ phone: phoneSchema })
const codeForm = z.object({ code: otpCodeSchema })

export interface OtpFlowLabels {
  phone: string
  sendCode: string
  code: string
  verify: string
  sentTo: (maskedPhone: string) => string
  changeNumber: string
  resend: string
}

export const DEFAULT_OTP_LABELS: OtpFlowLabels = {
  phone: 'Mobile number',
  sendCode: 'Send code on WhatsApp',
  code: '6-digit code',
  verify: 'Verify and continue',
  sentTo: (masked) => `Code sent on WhatsApp to ${masked}`,
  changeNumber: 'Change number',
  resend: 'Resend code',
}

export function OtpFlow({ scope, gymSlug, labels = DEFAULT_OTP_LABELS, onSuccess }: { scope: 'staff' | 'athlete'; gymSlug?: string; labels?: OtpFlowLabels; onSuccess: (result: LoginResponse) => void }) {
  const [phone, setPhone] = useState<string | null>(null)
  const [masked, setMasked] = useState('')
  const [choices, setChoices] = useState<GymChoice[] | null>(null)
  const [pendingCode, setPendingCode] = useState('')

  const first = useForm<z.input<typeof phoneForm>, unknown, z.output<typeof phoneForm>>({ resolver: zodResolver(phoneForm), defaultValues: { phone: '' } })
  const second = useForm<z.input<typeof codeForm>, unknown, z.output<typeof codeForm>>({ resolver: zodResolver(codeForm), defaultValues: { code: '' } })

  async function requestCode(value: string) {
    try {
      const result = await api<OtpRequestResponse>('/api/auth/otp/request', { method: 'POST', body: { phone: value, scope, gymSlug } })
      setPhone(value)
      setMasked(result.maskedPhone)
      toast.success(labels.sentTo(result.maskedPhone))
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send the code. Try again.')
    }
  }

  async function verify(code: string, chosenSlug?: string) {
    if (!phone) return
    try {
      const result = await api<LoginResponse>('/api/auth/otp/verify', { method: 'POST', body: { phone, code, scope, gymSlug: chosenSlug ?? gymSlug } })
      onSuccess(result)
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'GYM_SELECTION_REQUIRED') {
        const details = error.details as { gyms?: GymChoice[] } | undefined
        setPendingCode(code)
        setChoices(details?.gyms ?? [])
        return
      }
      second.setError('code', { message: error instanceof ApiClientError ? error.message : 'Could not verify. Try again.' })
    }
  }

  if (choices) {
    return (
      <div>
        <p className="muted" style={{ marginBottom: 12 }}>
          Your number works at more than one gym. Which one?
        </p>
        <div className="gym-choice">
          {choices.map((gym) => (
            <button key={gym.slug} type="button" onClick={() => verify(pendingCode, gym.slug)}>
              <span>
                <strong>{gym.name}</strong>
                <br />
                <small>{gym.city}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (!phone) {
    return (
      <form onSubmit={first.handleSubmit((values) => requestCode(values.phone))} noValidate>
        <div className="field">
          <label htmlFor="phone">{labels.phone}</label>
          <div className="phone-input">
            <span>+91</span>
            <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" aria-invalid={Boolean(first.formState.errors.phone)} {...first.register('phone')} />
          </div>
          {first.formState.errors.phone ? <span className="field-error">{first.formState.errors.phone.message}</span> : null}
        </div>
        <Button type="submit" className="lime-button auth-submit" disabled={first.formState.isSubmitting}>
          {first.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {labels.sendCode}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={second.handleSubmit((values) => verify(values.code))} noValidate>
      <div className="auth-sent">
        <span>{labels.sentTo(masked)}</span>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setPhone(null)
            second.reset()
          }}
        >
          {labels.changeNumber}
        </button>
      </div>
      <div className="field">
        <label htmlFor="code">{labels.code}</label>
        <input id="code" className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="------" aria-invalid={Boolean(second.formState.errors.code)} {...second.register('code')} />
        {second.formState.errors.code ? <span className="field-error">{second.formState.errors.code.message}</span> : null}
      </div>
      <Button type="submit" className="lime-button auth-submit" disabled={second.formState.isSubmitting}>
        {second.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        {labels.verify}
      </Button>
      <p className="auth-foot">
        <button type="button" className="link-button" onClick={() => requestCode(phone)}>
          {labels.resend}
        </button>
      </p>
    </form>
  )
}
