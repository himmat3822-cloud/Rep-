import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { BillingRunButton } from '@/components/admin/billing-run-button'
import { ClaimActions } from '@/components/admin/claim-actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { prisma } from '@/lib/db/client'
import { GRACE_DAYS, priceFor, RETENTION_DAYS, SUSPEND_AFTER_DAYS } from '@/lib/platform/billing'
import { formatInrExact } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Billing - Rep+ Admin' }

const DAY_MS = 86400000
const date = (value: Date | null | undefined) => (value ? formatIstDate(value, { day: 'numeric', month: 'short', year: '2-digit' }) : '-')

export default async function AdminBillingPage() {
  const now = new Date()
  const [subs, invoices, claims] = await Promise.all([
    prisma.gymSubscription.findMany({
      where: { OR: [{ status: { in: ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'] } }, { status: 'TRIAL', trialEndsAt: { lte: new Date(now.getTime() + 7 * DAY_MS) } }] },
      include: { plan: true, gym: { select: { id: true, name: true, city: true, override: true, _count: { select: { branches: { where: { archived: false } } } } } } },
      orderBy: { pastDueSince: 'asc' },
    }),
    prisma.platformInvoice.findMany({ orderBy: { createdAt: 'desc' }, take: 25, include: { subscription: { include: { gym: { select: { id: true, name: true } } } } } }),
    prisma.platformPaymentClaim.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
  ])
  const claimGyms = claims.length ? await prisma.gym.findMany({ where: { id: { in: claims.map((c) => c.gymId) } }, select: { id: true, name: true } }) : []
  const claimGymName = new Map(claimGyms.map((g) => [g.id, g.name]))
  const unpaid = subs.filter((sub) => sub.status !== 'TRIAL')
  const trials = subs.filter((sub) => sub.status === 'TRIAL')
  const amountDue = (sub: (typeof subs)[number]) =>
    priceFor({
      cycle: sub.cycle,
      monthlyPricePaise: sub.plan.monthlyPricePaise,
      annualPricePaise: sub.plan.annualPricePaise,
      branchLimit: sub.plan.branchLimit,
      extraBranchPaise: sub.plan.extraBranchPaise,
      customPricePaise: sub.gym.override?.customPricePaise,
      extraBranchesGranted: sub.gym.override?.extraBranches,
      branchCount: sub.gym._count.branches,
    }).totalPaise

  return (
    <AdminFrame title="Billing">
      <div className="page-head">
        <p>
          Due date, then PAST_DUE ({GRACE_DAYS}-day grace, daily reminders on WhatsApp and email), then READ_ONLY, then SUSPENDED {SUSPEND_AFTER_DAYS} days after the due date. Data is kept {RETENTION_DAYS} days after suspension. Runs daily at 6:00 AM IST.
        </p>
        <div className="toolbar">
          <a className="btn btn-outline" href="/api/admin/export/payments">
            <Download /> Payments CSV
          </a>
          <BillingRunButton />
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 18 }}>
        <p className="kicker accent-kicker">TO VERIFY</p>
        <h2>Payments owners say they made ({claims.length})</h2>
        <p className="muted" style={{ marginTop: 6 }}>Check the UTR in your bank / UPI app, then approve. Approving issues the Rep+ invoice and restores the gym immediately.</p>
        <div className="list-rows">
          {claims.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>Nothing waiting.</p> : null}
          {claims.map((claim) => (
            <div className="list-row" key={claim.id}>
              <span>
                <Link href={`/admin/gyms/${claim.gymId}`}>{claimGymName.get(claim.gymId) ?? claim.gymId}</Link>
                <br />
                <small className="mono">
                  {formatInrExact(claim.amountPaise)} by {claim.method} - ref {claim.reference} - {date(claim.createdAt)}
                </small>
              </span>
              <ClaimActions claimId={claim.id} />
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <p className="kicker accent-kicker">OVERDUE</p>
        <h2>Who has not paid</h2>
        <div className="table-wrap" style={{ marginTop: 14, border: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Gym</th>
                <th>Status</th>
                <th>Unpaid since</th>
                <th className="num">Days</th>
                <th className="num">Amount due (incl. GST)</th>
                <th>Last reminder</th>
              </tr>
            </thead>
            <tbody>
              {unpaid.map((sub) => (
                <tr key={sub.id}>
                  <td>
                    <Link href={`/admin/gyms/${sub.gym.id}`}>{sub.gym.name}</Link>
                    <span className="sub">
                      {sub.gym.city} - {sub.plan.name}
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={sub.status} />
                    {sub.manualOverride ? <span className="sub">admin hold</span> : null}
                  </td>
                  <td>{date(sub.pastDueSince ?? sub.suspendedAt)}</td>
                  <td className="num">{sub.pastDueSince ? Math.floor((now.getTime() - sub.pastDueSince.getTime()) / DAY_MS) : '-'}</td>
                  <td className="num">{formatInrExact(amountDue(sub))}</td>
                  <td>{date(sub.lastReminderAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unpaid.length === 0 ? <div className="table-empty">Everyone is paid up.</div> : null}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <p className="kicker">PAYMENTS</p>
          <h2>Latest Rep+ invoices</h2>
          <div className="list-rows">
            {invoices.map((invoice) => (
              <div className="list-row" key={invoice.id}>
                <span>
                  <Link href={`/admin/gyms/${invoice.subscription.gym.id}`}>{invoice.subscription.gym.name}</Link>
                  <br />
                  <small className="mono">
                    {invoice.number} - {invoice.razorpayPaymentId ? 'Razorpay' : 'offline / seed'}
                  </small>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {formatInrExact(invoice.amountPaise + invoice.gstPaise)}
                  <br />
                  <small>{date(invoice.paidAt)}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <p className="kicker">CONVERT</p>
          <h2>Trials ending in 7 days</h2>
          <div className="list-rows">
            {trials.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No trials ending this week.</p> : null}
            {trials.map((sub) => (
              <div className="list-row" key={sub.id}>
                <span>
                  <Link href={`/admin/gyms/${sub.gym.id}`}>{sub.gym.name}</Link>
                  <br />
                  <small>{sub.plan.name}</small>
                </span>
                <small>ends {date(sub.trialEndsAt)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminFrame>
  )
}
