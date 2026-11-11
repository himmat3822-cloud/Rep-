import type { Metadata } from 'next'
import QRCode from 'qrcode'
import { MessageCircle, Smartphone } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { StatusBadge } from '@/components/kit/status-badge'
import { PaymentClaimForm, PlanSwitcher } from '@/components/owner/billing-actions'
import { requireStaffPage } from '@/lib/auth/page'
import { prisma } from '@/lib/db/client'
import { tenantDb } from '@/lib/db/tenant'
import { priceFor } from '@/lib/platform/billing'
import { getGymLimits } from '@/lib/owner/limits'
import { kasratPaymentDetails, upiLink, whatsappLink } from '@/lib/platform/payment-details'
import { formatInr, formatInrExact } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Rep+ billing - Rep+' }

const date = (value: Date | null | undefined) => (value ? formatIstDate(value, { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

// Works even when the gym is suspended (requireStaffPage allows the owner).
export default async function OwnerBillingPage() {
  const ctx = await requireStaffPage(['OWNER'], { allowSuspended: true })
  const db = tenantDb(ctx.gym.id)
  const [sub, override, branchCount, limits, plans, claims] = await Promise.all([
    db.gymSubscription.findFirst({ include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 12 } } }),
    db.gymOverride.findFirst(),
    db.branch.count({ where: { archived: false } }),
    getGymLimits(db),
    prisma.platformPlan.findMany({ where: { archived: false }, orderBy: { sortOrder: 'asc' } }),
    prisma.platformPaymentClaim.findMany({ where: { gymId: ctx.gym.id }, orderBy: { createdAt: 'desc' }, take: 6 }),
  ])
  if (!sub) return <StaffShell ctx={ctx} title="Rep+ billing"><p className="muted">No subscription found. Contact Rep+ support.</p></StaffShell>

  const price = priceFor({
    cycle: sub.cycle,
    monthlyPricePaise: sub.plan.monthlyPricePaise,
    annualPricePaise: sub.plan.annualPricePaise,
    branchLimit: sub.plan.branchLimit,
    extraBranchPaise: sub.plan.extraBranchPaise,
    customPricePaise: override?.customPricePaise,
    extraBranchesGranted: override?.extraBranches,
    branchCount,
  })
  const details = kasratPaymentDetails()
  const note = `Rep+ ${ctx.gym.slug}`
  const upi = details.upiId ? upiLink(details.upiId, details.upiName, price.totalPaise, note) : null
  const qrSvg = upi ? await QRCode.toString(upi, { type: 'svg', margin: 1, width: 180, color: { dark: '#18211e', light: '#ffffff' } }) : null
  const pending = claims.find((claim) => claim.status === 'PENDING')
  const unpaid = ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].includes(sub.status)
  const headline = sub.status === 'TRIAL' ? `Free trial till ${date(sub.trialEndsAt)}` : unpaid ? `Payment overdue since ${date(sub.pastDueSince ?? sub.nextDueAt)}` : `Paid till ${date(sub.currentPeriodEnd)}`

  return (
    <StaffShell ctx={ctx} title="Rep+ billing" kicker="Your subscription">
      <div className="two-col">
        <div className="stack">
          <div className="plan-hero">
            <p className="kicker">YOUR KASRAT PLAN</p>
            <h2>
              {sub.plan.name} - {sub.cycle === 'ANNUAL' ? 'annual' : 'monthly'} <StatusBadge value={sub.status} />
            </h2>
            <p>{headline}</p>
            <div className="big">
              {formatInrExact(price.totalPaise)}
              <small>
                per {sub.cycle === 'ANNUAL' ? 'year' : 'month'} incl. {formatInrExact(price.gstPaise)} GST
              </small>
            </div>
            {price.extraBranches ? (
              <p style={{ marginTop: 8 }}>
                Includes {price.extraBranches} extra branch(es): {formatInr(price.extraBranchesPaise)}
              </p>
            ) : null}
          </div>

          <section className="panel">
            <p className="kicker">PAY KASRAT</p>
            <h2>{sub.status === 'TRIAL' ? 'Pay any time before your trial ends' : unpaid ? 'Pay now to switch everything back on' : 'Pay early for the next period'}</h2>
            <div className="two-col" style={{ marginTop: 14, gridTemplateColumns: qrSvg ? '190px 1fr' : '1fr' }}>
              {qrSvg ? <div dangerouslySetInnerHTML={{ __html: qrSvg }} /> : null}
              <div className="pay-box">
                {details.upiId ? (
                  <>
                    <strong>UPI: {details.upiId}</strong>
                    {'\n'}Scan the QR with any UPI app or tap the button on your phone.{'\n'}Add note: {note}
                  </>
                ) : (
                  'UPI details are not set up yet (KASRAT_UPI_ID).'
                )}
                {details.bankDetails ? `\n\nBank transfer:\n${details.bankDetails}` : ''}
              </div>
            </div>
            <div className="actions">
              {upi ? (
                <a className="btn btn-dark" href={upi}>
                  <Smartphone /> Pay {formatInrExact(price.totalPaise)} with UPI app
                </a>
              ) : null}
              {details.supportWhatsApp ? (
                <a className="btn btn-outline" href={whatsappLink(details.supportWhatsApp, `Hi Rep+, payment for ${ctx.gym.name} (${ctx.gym.slug})`)} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp support
                </a>
              ) : null}
            </div>
            <div style={{ marginTop: 18 }}>
              {pending ? (
                <p className="muted">
                  Payment of {formatInrExact(pending.amountPaise)} (ref {pending.reference}) is being verified. You will get a WhatsApp / email once it is confirmed.
                </p>
              ) : (
                <PaymentClaimForm amountRupees={price.totalPaise / 100} disabled={false} />
              )}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <p className="kicker">CHANGE PLAN</p>
            <h2>Upgrade or downgrade</h2>
            <p className="muted" style={{ margin: '6px 0 12px' }}>
              You use {limits.members.used} members and {limits.branches.used} branch(es). Downgrades are blocked if you are over the new limits.
            </p>
            <PlanSwitcher
              currentPlanId={sub.planId}
              currentCycle={sub.cycle}
              plans={plans.map((plan) => ({ id: plan.id, name: plan.name, monthlyPaise: plan.monthlyPricePaise, annualPaise: plan.annualPricePaise, memberLimit: plan.memberLimit, branchLimit: plan.branchLimit, isPopular: plan.isPopular }))}
            />
          </section>

          <section className="panel">
            <p className="kicker">HISTORY</p>
            <h2>Invoices and payments</h2>
            <div className="list-rows">
              {claims
                .filter((claim) => claim.status !== 'APPROVED')
                .map((claim) => (
                  <div className="list-row" key={claim.id}>
                    <span>
                      <span className="mono">{claim.reference}</span>
                      <br />
                      <small>{claim.status === 'REJECTED' ? `Rejected: ${claim.decision}` : `Submitted ${date(claim.createdAt)}`}</small>
                    </span>
                    <StatusBadge value={claim.status} />
                  </div>
                ))}
              {sub.invoices.map((invoice) => (
                <div className="list-row" key={invoice.id}>
                  <span>
                    <span className="mono">{invoice.number}</span>
                    <br />
                    <small>
                      {date(invoice.periodStart)} to {date(invoice.periodEnd)}
                    </small>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    {formatInrExact(invoice.amountPaise + invoice.gstPaise)}
                    <br />
                    <StatusBadge value={invoice.status} />
                  </span>
                </div>
              ))}
              {sub.invoices.length === 0 && claims.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No payments yet.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </StaffShell>
  )
}
