import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { GymActions } from '@/components/admin/gym-actions'
import { GymEditForm, OverrideForm } from '@/components/admin/gym-forms'
import { StatusBadge } from '@/components/kit/status-badge'
import { prisma } from '@/lib/db/client'
import { effectiveLimits, getGymDetail } from '@/lib/platform/gyms'
import { resolveFeatures } from '@/lib/features'
import { formatInr, formatInrExact } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Gym - Rep+ Admin' }

const date = (value: Date | null | undefined) => (value ? formatIstDate(value, { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

export default async function AdminGymDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, plans] = await Promise.all([getGymDetail(prisma, id), prisma.platformPlan.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, archived: true } })])
  if (!detail || !detail.gym.subscription) notFound()
  const { gym, price, usage, audit, activeMembers, mrrPaise } = detail
  const sub = gym.subscription!
  const override = gym.override
  const limits = effectiveLimits(sub.plan, override)
  const features = resolveFeatures(sub.plan.features, override?.extraFeatures ?? [], override?.removedFeatures ?? [])
  const owner = gym.staff.find((member) => member.kind === 'OWNER')
  const lastPaid = sub.invoices.find((invoice) => invoice.status === 'PAID')

  return (
    <AdminFrame title={gym.name} kicker="Gym details">
      <div className="page-head">
        <div>
          <StatusBadge value={gym.subscriptionStatus} />
          <h1>{gym.name}</h1>
          <p>
            {gym.city} - /g/{gym.slug} - created {date(gym.createdAt)}
            {sub.statusReason ? ` - last change: ${sub.statusReason}` : ''}
          </p>
        </div>
        <div className="toolbar">
          <a className="btn btn-outline" href={`/g/${gym.slug}/login`} target="_blank" rel="noreferrer">
            <ExternalLink /> Member app
          </a>
          <Link className="btn btn-outline" href={`/admin/audit?gymId=${gym.id}`}>
            Full audit log
          </Link>
        </div>
      </div>

      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric-card"><div className="metric-copy"><span>Members</span><strong>{gym._count.athletes}</strong><small>{activeMembers} with an active plan{limits.members !== null ? `, limit ${limits.members}` : ', unlimited'}</small></div></div>
        <div className="metric-card"><div className="metric-copy"><span>MRR</span><strong>{formatInr(mrrPaise)}</strong><small>{price ? `${formatInrExact(price.totalPaise)} per ${sub.cycle === 'ANNUAL' ? 'year' : 'month'} incl. GST` : '-'}</small></div></div>
        <div className="metric-card"><div className="metric-copy"><span>WhatsApp this month</span><strong>{usage?.sent ?? 0}</strong><small>of {limits.whatsapp} messages</small></div></div>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <p className="kicker">SUBSCRIPTION</p>
            <h2>
              {sub.plan.name} - {sub.cycle === 'ANNUAL' ? 'annual' : 'monthly'}
            </h2>
            <dl className="kv">
              <dt>Owner</dt>
              <dd>
                {owner ? `${owner.name} - ${owner.phone}${owner.email ? ` - ${owner.email}` : ''}` : '-'}
              </dd>
              <dt>Trial ends</dt>
              <dd>{date(sub.trialEndsAt)}</dd>
              <dt>Current period</dt>
              <dd>
                {date(sub.currentPeriodStart)} to {date(sub.currentPeriodEnd)}
              </dd>
              <dt>Next due</dt>
              <dd>{date(sub.nextDueAt)}</dd>
              <dt>Unpaid since</dt>
              <dd>{date(sub.pastDueSince)}</dd>
              <dt>Last payment</dt>
              <dd>{lastPaid ? `${formatInrExact(lastPaid.amountPaise + lastPaid.gstPaise)} on ${date(lastPaid.paidAt)}` : '-'}</dd>
              <dt>Free months left</dt>
              <dd>{override?.freeMonthsLeft ?? 0}</dd>
              <dt>Data purge after</dt>
              <dd>{date(sub.dataPurgeAfter)}</dd>
              <dt>Admin hold</dt>
              <dd>{sub.manualOverride ? 'Yes - automation paused' : 'No'}</dd>
              <dt>Razorpay sub</dt>
              <dd className="mono">{sub.razorpaySubscriptionId ?? '-'}</dd>
              <dt>Limits</dt>
              <dd>
                {limits.branches} branch(es), {limits.staff ?? 'unlimited'} staff, {limits.members ?? 'unlimited'} members
              </dd>
              <dt>Features</dt>
              <dd style={{ fontWeight: 400 }}>{features.length} enabled</dd>
            </dl>
          </section>

          <GymEditForm
            gymId={gym.id}
            plans={plans}
            defaults={{ name: gym.name, slug: gym.slug, city: gym.city, address: gym.address, gstNumber: gym.gstNumber ?? '', planId: sub.planId, cycle: sub.cycle, ownerHandlesDesk: gym.ownerHandlesDesk }}
          />

          <OverrideForm
            gymId={gym.id}
            planFeatures={sub.plan.features}
            defaults={{
              customPriceRupees: override?.customPricePaise !== null && override?.customPricePaise !== undefined ? override.customPricePaise / 100 : '',
              extraMembers: override?.extraMembers ?? 0,
              extraBranches: override?.extraBranches ?? 0,
              extraStaff: override?.extraStaff ?? 0,
              whatsappTopUp: override?.whatsappTopUp ?? 0,
              note: override?.note ?? '',
              extraFeatures: override?.extraFeatures ?? [],
              removedFeatures: override?.removedFeatures ?? [],
            }}
          />
        </div>

        <div className="stack">
          <GymActions gymId={gym.id} gymName={gym.name} status={gym.subscriptionStatus} />

          <section className="panel">
            <p className="kicker">PEOPLE</p>
            <h2>Branches and staff</h2>
            <div className="list-rows">
              {gym.branches.map((branch) => (
                <div className="list-row" key={branch.id}>
                  <span>
                    <strong>{branch.name}</strong>
                    <br />
                    <small>{branch.address || 'No address'} - {branch.hourlyCapacity}/hour</small>
                  </span>
                  {branch.isPrimary ? <span className="badge badge-lime">Primary</span> : null}
                </div>
              ))}
              {gym.staff.map((member) => (
                <div className="list-row" key={member.id}>
                  <span>
                    <strong>{member.name}</strong>
                    <br />
                    <small>
                      {member.phone} - last login {member.lastLoginAt ? date(member.lastLoginAt) : 'never'}
                    </small>
                  </span>
                  <StatusBadge value={member.kind} label={member.active ? member.kind.toLowerCase() : 'disabled'} />
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <p className="kicker">KASRAT INVOICES</p>
            <h2>Payments</h2>
            <div className="list-rows">
              {sub.invoices.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No invoices yet.</p> : null}
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
            </div>
          </section>

          <section className="panel">
            <p className="kicker">RECENT ACTIVITY</p>
            <h2>Audit</h2>
            <div className="list-rows">
              {audit.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>Nothing logged yet.</p> : null}
              {audit.map((row) => (
                <div className="list-row" key={row.id}>
                  <span>
                    <span className="mono">{row.action}</span>
                    <br />
                    <small>{row.reason ?? row.entity}</small>
                  </span>
                  <small>{formatIstDate(row.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AdminFrame>
  )
}
