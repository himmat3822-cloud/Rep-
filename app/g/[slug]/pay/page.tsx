import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { PayView } from '@/components/athlete/pay'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { currentMembership, freezeAllowance, renewalOptions } from '@/lib/athlete/payments'
import { upiLink } from '@/lib/platform/payment-details'
import { daysBetween, istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'Pay - Rep+' }

export default async function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const config = await loadGymConfig(db, gym.id)
  const upiId = config.settings.memberUpiId ?? null
  const today = istDateOnly()

  const [membership, dues, claims, payments, invoices, options, freeze, freezeRequests] = await Promise.all([
    currentMembership(db, athlete.id),
    db.due.findMany({ where: { athleteId: athlete.id, status: 'OPEN' }, orderBy: { dueDate: 'asc' } }),
    db.memberPaymentClaim.findMany({ where: { athleteId: athlete.id, OR: [{ status: 'PENDING' }, { status: 'REJECTED', createdAt: { gte: new Date(Date.now() - 14 * 86400000) } }] }, orderBy: { createdAt: 'desc' } }),
    db.payment.findMany({ where: { athleteId: athlete.id, status: 'PAID' }, orderBy: { paidAt: 'desc' }, take: 30 }),
    db.invoice.findMany({ where: { athleteId: athlete.id }, select: { id: true, number: true, paymentId: true } }),
    renewalOptions(db, athlete.id, config.rawSettings),
    freezeAllowance(db, athlete.id),
    db.freezeRequest.findMany({ where: { athleteId: athlete.id, status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 1 }),
  ])
  const plan = membership ? await db.membershipPlan.findFirst({ where: { id: membership.planId }, select: { name: true } }) : null
  const invoiceByPayment = new Map(invoices.map((i) => [i.paymentId, i]))
  const latestFreeze = freezeRequests[0] ?? null

  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <PayView
        slug={slug}
        lang={athlete.language}
        gymName={gym.name}
        upiId={upiId}
        membership={
          membership
            ? {
                planName: plan?.name ?? 'Membership',
                endsAt: membership.endsAt.toISOString().slice(0, 10),
                daysLeft: Math.max(0, daysBetween(today, membership.endsAt)),
                frozenUntil: membership.status === 'FROZEN' && membership.frozenUntil ? membership.frozenUntil.toISOString().slice(0, 10) : null,
              }
            : null
        }
        dues={dues.map((due) => ({ id: due.id, amountPaise: due.amountPaise, dueDate: due.dueDate.toISOString().slice(0, 10), upi: upiId ? upiLink(upiId, gym.name, due.amountPaise, `${athlete.memberCode} dues`) : null }))}
        claims={claims.map((c) => ({ id: c.id, kind: c.kind, dueId: c.dueId, amountPaise: c.amountPaise, utr: c.utr, status: c.status, decision: c.decision }))}
        renewal={{ ...options, plans: options.plans.map((p) => ({ ...p, upi: upiId ? upiLink(upiId, gym.name, p.totalPaise, `${athlete.memberCode} ${p.name}`) : null })) }}
        payments={payments.map((p) => ({ id: p.id, amountPaise: p.amountPaise, method: p.method, paidAt: (p.paidAt ?? p.createdAt).toISOString(), invoiceId: invoiceByPayment.get(p.id)?.id ?? null, invoiceNumber: invoiceByPayment.get(p.id)?.number ?? null }))}
        freeze={{ daysLeft: freeze.daysLeft, hasPlan: Boolean(freeze.membership), latest: latestFreeze ? { id: latestFreeze.id, status: latestFreeze.status, days: latestFreeze.days, fromDate: latestFreeze.fromDate.toISOString().slice(0, 10) } : null }}
      />
    </AthleteChrome>
  )
}
