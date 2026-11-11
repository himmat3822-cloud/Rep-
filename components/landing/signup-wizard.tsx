'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import type { OtpRequestResponse } from '@/lib/api/types'
import { phoneSchema, otpCodeSchema, slugSchema } from '@/lib/validation/auth'
import { formatInr } from '@/lib/money'

// Owner onboarding: verify phone -> gym details -> front desk question ->
// plan -> 14-day trial. No card, no payment gateway.

export interface WizardPlan {
  id: string
  code: string
  name: string
  monthlyPaise: number
  annualPaise: number
  memberLimit: number | null
  branchLimit: number
  isPopular: boolean
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const CITIES = ['Mohali', 'Chandigarh', 'Zirakpur', 'Panchkula', 'Kharar', 'Derabassi', 'Other']

export function SignupWizard({ plans, initialPlan, initialCycle }: { plans: WizardPlan[]; initialPlan?: string; initialCycle?: 'MONTHLY' | 'ANNUAL' }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [codeSent, setCodeSent] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [details, setDetails] = useState({ ownerName: '', ownerEmail: '', ownerPassword: '', gymName: '', slug: '', city: 'Mohali', address: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle')
  const [desk, setDesk] = useState<boolean | null>(null)
  const [planId, setPlanId] = useState(plans.find((plan) => plan.code === initialPlan)?.id ?? plans.find((plan) => plan.isPopular)?.id ?? plans[0]?.id ?? '')
  const [cycle, setCycle] = useState<'MONTHLY' | 'ANNUAL'>(initialCycle ?? 'MONTHLY')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!details.slug) return setSlugState('idle')
    if (!slugSchema.safeParse(details.slug).success) return setSlugState('invalid')
    setSlugState('checking')
    const timer = setTimeout(() => {
      api<{ available: boolean }>(`/api/signup/slug?slug=${encodeURIComponent(details.slug)}`)
        .then((result) => setSlugState(result.available ? 'ok' : 'taken'))
        .catch(() => setSlugState('invalid'))
    }, 300)
    return () => clearTimeout(timer)
  }, [details.slug])

  const fail = (error: unknown, fallback: string) => toast.error(error instanceof ApiClientError ? error.message : fallback)

  async function sendCode() {
    const parsed = phoneSchema.safeParse(phone)
    if (!parsed.success) return setErrors({ phone: parsed.error.issues[0].message })
    setErrors({})
    setBusy(true)
    try {
      const result = await api<OtpRequestResponse>('/api/signup/otp', { method: 'POST', body: { phone: parsed.data } })
      setCodeSent(result.maskedPhone)
      toast.success(`Code sent on WhatsApp to ${result.maskedPhone}`)
    } catch (error) {
      fail(error, 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    const parsedCode = otpCodeSchema.safeParse(code)
    if (!parsedCode.success) return setErrors({ code: parsedCode.error.issues[0].message })
    setBusy(true)
    try {
      const result = await api<{ ticket: string }>('/api/signup/verify', { method: 'POST', body: { phone, code } })
      setTicket(result.ticket)
      setErrors({})
      setStep(1)
    } catch (error) {
      if (error instanceof ApiClientError) setErrors({ code: error.message })
      else fail(error, 'Could not verify')
    } finally {
      setBusy(false)
    }
  }

  function detailsNext() {
    const next: Record<string, string> = {}
    if (details.ownerName.trim().length < 2) next.ownerName = 'Enter your name'
    if (details.gymName.trim().length < 2) next.gymName = 'Enter your gym name'
    if (slugState !== 'ok') next.slug = slugState === 'taken' ? 'This link is taken' : 'Pick a valid link (letters, numbers, dashes)'
    if (details.ownerEmail && !/^\S+@\S+\.\S+$/.test(details.ownerEmail)) next.ownerEmail = 'Enter a valid email'
    if (details.ownerPassword && details.ownerPassword.length < 8) next.ownerPassword = 'At least 8 characters'
    setErrors(next)
    if (Object.keys(next).length === 0) setStep(2)
  }

  async function finish() {
    setBusy(true)
    try {
      const result = await api<{ redirectTo: string }>('/api/signup', { method: 'POST', body: { ticket, ...details, ownerHandlesDesk: desk ?? true, planId, cycle } })
      toast.success('Your gym is live! 14-day free trial started.')
      router.replace(result.redirectTo)
      router.refresh()
    } catch (error) {
      fail(error, 'Could not create your gym')
      if (error instanceof ApiClientError && error.code === 'INVALID_OTP') setStep(0)
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof details) => (event: { target: { value: string } }) => {
    const value = event.target.value
    setDetails((current) => ({ ...current, [key]: value, ...(key === 'gymName' && !slugTouched ? { slug: slugify(value) } : {}) }))
  }

  return (
    <div className="auth-card signup-card">
      <div className="steps">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={index < step ? 'done' : index === step ? 'current' : ''} />
        ))}
      </div>

      {step === 0 ? (
        <>
          <span className="kicker">STEP 1 OF 4</span>
          <h2>Verify your WhatsApp</h2>
          <p className="muted">Your number is your login. We send a 6-digit code on WhatsApp.</p>
          <div className="field">
            <label htmlFor="s-phone">Mobile number</label>
            <div className="phone-input">
              <span>+91</span>
              <input id="s-phone" inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={Boolean(codeSent)} placeholder="98765 43210" />
            </div>
            {errors.phone ? <span className="field-error">{errors.phone}</span> : null}
          </div>
          {codeSent ? (
            <>
              <div className="auth-sent">
                <span>Code sent to {codeSent}</span>
                <button type="button" className="link-button" onClick={() => setCodeSent(null)}>
                  Change number
                </button>
              </div>
              <div className="field">
                <label htmlFor="s-code">6-digit code</label>
                <input id="s-code" className="otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
                {errors.code ? <span className="field-error">{errors.code}</span> : null}
              </div>
              <button className="btn btn-lime auth-submit" type="button" disabled={busy} onClick={verifyCode}>
                {busy ? <Loader2 className="animate-spin" /> : null} Verify
              </button>
            </>
          ) : (
            <button className="btn btn-lime auth-submit" type="button" disabled={busy} onClick={sendCode}>
              {busy ? <Loader2 className="animate-spin" /> : null} Send code on WhatsApp
            </button>
          )}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <span className="kicker">STEP 2 OF 4</span>
          <h2>About your gym</h2>
          <div className="field">
            <label>Your name</label>
            <input value={details.ownerName} onChange={set('ownerName')} />
            {errors.ownerName ? <span className="field-error">{errors.ownerName}</span> : null}
          </div>
          <div className="field">
            <label>Gym name</label>
            <input value={details.gymName} onChange={set('gymName')} placeholder="Forge Fitness" />
            {errors.gymName ? <span className="field-error">{errors.gymName}</span> : null}
          </div>
          <div className="field">
            <label>Member app link</label>
            <input
              value={details.slug}
              onChange={(event) => {
                setSlugTouched(true)
                setDetails((current) => ({ ...current, slug: slugify(event.target.value) }))
              }}
            />
            <span className="hint">
              kasrat.app/g/{details.slug || 'your-gym'} - {slugState === 'ok' ? 'available' : slugState === 'taken' ? 'taken' : slugState === 'checking' ? 'checking...' : ''}
            </span>
            {errors.slug ? <span className="field-error">{errors.slug}</span> : null}
          </div>
          <div className="form-grid" style={{ marginTop: 0 }}>
            <div className="field">
              <label>City</label>
              <select value={details.city} onChange={set('city')}>
                {CITIES.map((city) => (
                  <option key={city}>{city}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Address (optional)</label>
              <input value={details.address} onChange={set('address')} />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input type="email" value={details.ownerEmail} onChange={set('ownerEmail')} />
              {errors.ownerEmail ? <span className="field-error">{errors.ownerEmail}</span> : null}
            </div>
            <div className="field">
              <label>Password (optional)</label>
              <input type="password" autoComplete="new-password" value={details.ownerPassword} onChange={set('ownerPassword')} />
              {errors.ownerPassword ? <span className="field-error">{errors.ownerPassword}</span> : <span className="hint">For email login. WhatsApp OTP always works.</span>}
            </div>
          </div>
          <button className="btn btn-lime auth-submit" type="button" onClick={detailsNext}>
            Next <ArrowRight />
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <span className="kicker">STEP 3 OF 4</span>
          <h2>Do you also manage the reception?</h2>
          <p className="muted">Rep+ adapts. You can change this any time in Settings.</p>
          <div className="choice-cards">
            <button type="button" className={desk === true ? 'on' : ''} onClick={() => setDesk(true)}>
              <strong>Yes, I handle it</strong>
              <small>Check-ins, quick add and collecting payments go straight into your menu. No extra login.</small>
            </button>
            <button type="button" className={desk === false ? 'on' : ''} onClick={() => setDesk(false)}>
              <strong>No, I have a receptionist</strong>
              <small>You can add front desk staff with their own login and limited permissions.</small>
            </button>
          </div>
          <div className="actions">
            <button className="btn btn-outline" type="button" onClick={() => setStep(1)}>
              <ArrowLeft /> Back
            </button>
            <button className="btn btn-lime" type="button" disabled={desk === null} onClick={() => setStep(3)}>
              Next <ArrowRight />
            </button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <span className="kicker">STEP 4 OF 4</span>
          <h2>Pick a plan</h2>
          <p className="muted">Everything is free for 14 days. No card needed. Prices exclude GST.</p>
          <div className="lang-toggle" style={{ marginBottom: 12 }}>
            <button type="button" className={cycle === 'MONTHLY' ? 'active' : ''} onClick={() => setCycle('MONTHLY')}>
              Monthly
            </button>
            <button type="button" className={cycle === 'ANNUAL' ? 'active' : ''} onClick={() => setCycle('ANNUAL')}>
              Annual - 2 months free
            </button>
          </div>
          <div className="radio-cards" style={{ gridTemplateColumns: '1fr' }}>
            {plans.map((plan) => (
              <label key={plan.id} className={plan.id === planId ? 'on' : ''}>
                <input type="radio" checked={plan.id === planId} onChange={() => setPlanId(plan.id)} />
                <strong>
                  {plan.name} {plan.isPopular ? <span className="price-tag">Most popular</span> : null}
                </strong>
                <span>
                  {formatInr(cycle === 'ANNUAL' ? plan.annualPaise : plan.monthlyPaise)} / {cycle === 'ANNUAL' ? 'year' : 'month'}
                </span>
                <small>
                  {plan.memberLimit ?? 'Unlimited'} members, {plan.branchLimit} branch(es)
                </small>
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="btn btn-outline" type="button" onClick={() => setStep(2)}>
              <ArrowLeft /> Back
            </button>
            <button className="btn btn-lime" type="button" disabled={busy || !planId} onClick={finish}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Start my 14-day trial
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
