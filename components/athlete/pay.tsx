'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BadgeCheck, CalendarClock, CircleAlert, Clock, FileText, Loader2, Lock, PauseCircle, RefreshCw, Send, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'
import { formatInr } from '@/lib/money'
import { claimSchema, freezeRequestSchema, type ClaimFormInput, type ClaimFormOutput, type FreezeRequestInput, type FreezeRequestOutput } from '@/lib/validation/athlete'

// Pay tab: plan, dues with UPI + "I've paid", early renewal, history with
// GST invoices, and freeze requests. Dues stay private to the member.

const LOCALE: Record<Lang, string> = { EN: 'en-IN', HI: 'hi-IN', PA: 'pa-IN' }
const fmtDate = (iso: string, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length > 10 ? 'Asia/Kolkata' : 'UTC' }).format(new Date(iso.length > 10 ? iso : `${iso}T00:00:00Z`))

interface Props {
  slug: string
  lang: Lang
  gymName: string
  upiId: string | null
  membership: { planName: string; endsAt: string; daysLeft: number; frozenUntil: string | null } | null
  dues: { id: string; amountPaise: number; dueDate: string; upi: string | null }[]
  claims: { id: string; kind: string; dueId: string | null; amountPaise: number; utr: string; status: string; decision: string | null }[]
  renewal: { early: boolean; discountPct: number; plans: { id: string; name: string; durationDays: number; pricePaise: number; discountPaise: number; totalPaise: number; upi: string | null }[] }
  payments: { id: string; amountPaise: number; method: string; paidAt: string; invoiceId: string | null; invoiceNumber: string | null }[]
  freeze: { daysLeft: number; hasPlan: boolean; latest: { id: string; status: string; days: number; fromDate: string } | null }
}

export function PayView(props: Props) {
  const { slug, lang } = props
  const t = translator(lang)
  const [claimFor, setClaimFor] = useState<{ kind: 'DUE' | 'RENEWAL'; id: string; amountPaise: number } | null>(null)
  const [renewPlan, setRenewPlan] = useState<string | null>(null)
  const pendingFor = (dueId: string) => props.claims.find((c) => c.dueId === dueId && c.status === 'PENDING')
  const pendingRenewal = props.claims.find((c) => c.kind === 'RENEWAL' && c.status === 'PENDING')

  return (
    <div className="a-page">
      <div className="a-head">
        <h1>{t('money', 'title')}</h1>
      </div>

      <section className="a-card plan-hero">
        <small className="kicker">{t('money', 'yourPlan')}</small>
        {props.membership ? (
          <>
            <h2>{props.membership.planName}</h2>
            {props.membership.frozenUntil ? (
              <p className="pill warn">
                <PauseCircle /> {t('money', 'frozen', { date: fmtDate(props.membership.frozenUntil, lang) })}
              </p>
            ) : null}
            <div className="row-between">
              <span>{t('money', 'endsOn', { date: fmtDate(props.membership.endsAt, lang) })}</span>
              <strong>{t('money', 'daysLeft', { days: props.membership.daysLeft })}</strong>
            </div>
          </>
        ) : (
          <p className="muted">{t('money', 'noPlan')}</p>
        )}
      </section>

      <section className="a-card">
        <div className="row-between">
          <h3>{t('money', 'dues')}</h3>
          <small className="private-note">
            <Lock /> {t('money', 'private')}
          </small>
        </div>
        {props.dues.length === 0 ? (
          <p className="all-clear">
            <BadgeCheck /> {t('money', 'noDues')}
          </p>
        ) : (
          props.dues.map((due) => {
            const pending = pendingFor(due.id)
            return (
              <div key={due.id} className="due-row">
                <div className="row-between">
                  <div>
                    <strong className="amount">{formatInr(due.amountPaise)}</strong>
                    <small>{t('money', 'dueOn', { date: fmtDate(due.dueDate, lang) })}</small>
                  </div>
                </div>
                {pending ? (
                  <p className="tip">
                    <Clock /> {t('money', 'claimPending', { amount: formatInr(pending.amountPaise), utr: pending.utr })}
                  </p>
                ) : (
                  <div className="pay-actions">
                    {due.upi ? (
                      <a className="btn btn-lime" href={due.upi}>
                        <Smartphone /> {t('money', 'payUpi')}
                      </a>
                    ) : (
                      <p className="muted">{t('money', 'noUpi')}</p>
                    )}
                    {props.upiId ? (
                      <button type="button" className="btn btn-outline" onClick={() => setClaimFor({ kind: 'DUE', id: due.id, amountPaise: due.amountPaise })}>
                        <Send /> {t('money', 'paidAlready')}
                      </button>
                    ) : null}
                  </div>
                )}
                {claimFor?.kind === 'DUE' && claimFor.id === due.id ? <ClaimForm slug={slug} lang={lang} kind="DUE" id={due.id} amountPaise={due.amountPaise} upiId={props.upiId} onDone={() => setClaimFor(null)} /> : null}
              </div>
            )
          })
        )}
        {props.claims
          .filter((c) => c.status === 'REJECTED')
          .map((claim) => (
            <p key={claim.id} className="tip danger">
              <CircleAlert /> {t('money', 'claimRejected', { amount: formatInr(claim.amountPaise), utr: claim.utr, reason: claim.decision ?? '' })}
            </p>
          ))}
      </section>

      <section className="a-card">
        <h3>
          <RefreshCw /> {props.membership ? t('money', 'renewTitle') : t('money', 'joinTitle')}
        </h3>
        {props.membership ? <p className="muted">{t('money', 'renewNote')}</p> : null}
        {props.renewal.early && props.renewal.discountPct > 0 ? <p className="pill lime">{t('money', 'renewDiscount', { pct: props.renewal.discountPct })}</p> : null}
        {pendingRenewal ? (
          <p className="tip">
            <Clock /> {t('money', 'claimPending', { amount: formatInr(pendingRenewal.amountPaise), utr: pendingRenewal.utr })}
          </p>
        ) : (
          <div className="plan-list">
            {props.renewal.plans.map((plan) => (
              <div key={plan.id} className={`plan-option ${renewPlan === plan.id ? 'on' : ''}`}>
                <button type="button" className="plan-pick" onClick={() => setRenewPlan(renewPlan === plan.id ? null : plan.id)}>
                  <span>
                    <strong>{plan.name}</strong>
                    <small>{plan.durationDays} days</small>
                  </span>
                  <span className="price">
                    {plan.discountPaise > 0 ? <s>{formatInr(plan.totalPaise + plan.discountPaise)}</s> : null}
                    <strong>{formatInr(plan.totalPaise)}</strong>
                  </span>
                </button>
                {renewPlan === plan.id ? (
                  <div className="plan-pay">
                    {plan.upi ? (
                      <>
                        <a className="btn btn-lime btn-block" href={plan.upi}>
                          <Smartphone /> {t('money', 'renewPay', { amount: formatInr(plan.totalPaise), plan: plan.name })}
                        </a>
                        <ClaimForm slug={slug} lang={lang} kind="RENEWAL" id={plan.id} amountPaise={plan.totalPaise} upiId={props.upiId} onDone={() => setRenewPlan(null)} />
                      </>
                    ) : (
                      <p className="muted">{t('money', 'noUpi')}</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <FreezeCard slug={slug} lang={lang} freeze={props.freeze} />

      <section className="a-card">
        <h3>{t('money', 'history')}</h3>
        {props.payments.length === 0 ? (
          <p className="muted">{t('money', 'noPayments')}</p>
        ) : (
          <ul className="booking-list">
            {props.payments.map((payment) => (
              <li key={payment.id}>
                <span>
                  <strong>{formatInr(payment.amountPaise)}</strong> <small>{payment.method} - {fmtDate(payment.paidAt, lang)}</small>
                </span>
                {payment.invoiceId ? (
                  <a className="btn btn-outline btn-sm" href={`/api/gym/invoices/${payment.invoiceId}/pdf`} target="_blank" rel="noreferrer">
                    <FileText /> {t('money', 'invoice')}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ClaimForm({ slug, lang, kind, id, amountPaise, upiId, onDone }: { slug: string; lang: Lang; kind: 'DUE' | 'RENEWAL'; id: string; amountPaise: number; upiId: string | null; onDone: () => void }) {
  const t = translator(lang)
  const router = useRouter()
  const form = useForm<ClaimFormInput, unknown, ClaimFormOutput>({
    resolver: zodResolver(claimSchema),
    defaultValues: { kind, dueId: kind === 'DUE' ? id : undefined, planId: kind === 'RENEWAL' ? id : undefined, amountRupees: amountPaise / 100, utr: '', note: '' },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/api/g/${slug}/me/claims`, { method: 'POST', body: values, session: 'athlete' })
      toast.success(t('money', 'claimSent'))
      onDone()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send')
    }
  })
  return (
    <form className="claim-form" onSubmit={submit} noValidate>
      <strong>{t('money', 'claimTitle')}</strong>
      {upiId ? <small className="muted">{t('money', 'upiTo', { upi: upiId })}</small> : null}
      <label className="field">
        <span>{t('money', 'amount')}</span>
        <input type="number" inputMode="decimal" step="1" {...form.register('amountRupees')} />
        {errors.amountRupees ? <span className="field-error">{errors.amountRupees.message}</span> : null}
      </label>
      <label className="field">
        <span>{t('money', 'utr')}</span>
        <input inputMode="numeric" autoComplete="off" placeholder="412345678901" {...form.register('utr')} />
        {errors.utr ? <span className="field-error">{errors.utr.message}</span> : <span className="hint">{t('money', 'utrHint')}</span>}
      </label>
      <label className="field">
        <span>{t('money', 'note')}</span>
        <input maxLength={200} {...form.register('note')} />
      </label>
      <div className="row-between">
        <button type="button" className="btn btn-outline btn-sm" onClick={onDone}>
          <X /> {t('nav', 'cancel')}
        </button>
        <button className="btn btn-dark btn-sm" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="spin" /> : <Send />} {t('money', 'sendClaim')}
        </button>
      </div>
    </form>
  )
}

function FreezeCard({ slug, lang, freeze }: { slug: string; lang: Lang; freeze: Props['freeze'] }) {
  const t = translator(lang)
  const router = useRouter()
  const tomorrow = new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)
  const form = useForm<FreezeRequestInput, unknown, FreezeRequestOutput>({ resolver: zodResolver(freezeRequestSchema), defaultValues: { fromDate: tomorrow, days: Math.min(7, Math.max(1, freeze.daysLeft)), reason: '' } })
  const { errors, isSubmitting } = form.formState
  const latest = freeze.latest

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/api/g/${slug}/me/freeze`, { method: 'POST', body: values, session: 'athlete' })
      toast.success(t('money', 'freezeSent'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send')
    }
  })

  async function withdraw(id: string) {
    try {
      await api(`/api/g/${slug}/me/freeze/${id}`, { method: 'DELETE', session: 'athlete' })
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not cancel')
    }
  }

  if (!freeze.hasPlan) return null
  return (
    <section className="a-card">
      <h3>
        <CalendarClock /> {t('money', 'freezeTitle')}
      </h3>
      <p className="muted">{t('money', 'freezeNote')}</p>
      {latest?.status === 'PENDING' ? (
        <div className="tip">
          <Clock /> {t('money', 'freezePending', { days: latest.days, date: fmtDate(latest.fromDate, lang) })}
          <button type="button" className="link-like" onClick={() => withdraw(latest.id)}>
            {t('money', 'cancelRequest')}
          </button>
        </div>
      ) : (
        <>
          {latest?.status === 'APPROVED' ? <p className="tip">{t('money', 'freezeApproved', { days: latest.days, date: fmtDate(latest.fromDate, lang) })}</p> : null}
          {latest?.status === 'REJECTED' ? <p className="tip danger">{t('money', 'freezeRejected')}</p> : null}
          {freeze.daysLeft > 0 ? (
            <form className="freeze-form" onSubmit={submit} noValidate>
              <small className="pill">{t('money', 'freezeLeft', { days: freeze.daysLeft })}</small>
              <div className="record-form">
                <label className="field">
                  <span>{t('money', 'fromDate')}</span>
                  <input type="date" min={tomorrow} {...form.register('fromDate')} />
                </label>
                <label className="field">
                  <span>{t('money', 'days')}</span>
                  <input type="number" min={1} max={freeze.daysLeft} {...form.register('days')} />
                  {errors.days ? <span className="field-error">{errors.days.message}</span> : null}
                </label>
              </div>
              <label className="field">
                <span>{t('money', 'reason')}</span>
                <input maxLength={200} {...form.register('reason')} />
                {errors.reason ? <span className="field-error">{errors.reason.message}</span> : null}
              </label>
              <button className="btn btn-dark btn-block" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" /> : <PauseCircle />} {t('money', 'requestFreeze')}
              </button>
            </form>
          ) : (
            <p className="muted">{t('money', 'freezeNone')}</p>
          )}
        </>
      )}
    </section>
  )
}
