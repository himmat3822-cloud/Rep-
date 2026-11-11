import type { Metadata } from 'next'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { Pager } from '@/components/kit/pager'
import { RemindButton } from '@/components/owner/remind-button'
import { ClaimsQueue, FreezeQueue, pendingCounts } from '@/components/owner/request-queues'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { formatInr } from '@/lib/money'
import { formatIstDate, istDateOnly, istStartOfMonth } from '@/lib/time'

export const metadata: Metadata = { title: 'Payments and dues - Rep+' }

const PAGE_SIZE = 40
const when = (date: Date | null) => (date ? formatIstDate(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-')

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const { tab = 'payments', page: rawPage } = await searchParams
  const page = Math.max(1, Number(rawPage) || 1)
  const db = tenantDb(ctx.gym.id)
  const monthStart = istStartOfMonth()
  const today = istDateOnly()

  const stageNames = tab === 'dues' ? new Map((await db.reminderStage.findMany({ select: { stage: true, name: true } })).map((s) => [s.stage, s.name])) : new Map<number, string>()
  const [byMethod, dueTotal, payments, paymentCount, dues] = await Promise.all([
    db.payment.groupBy({ by: ['method'], where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amountPaise: true }, _count: { _all: true } }),
    db.due.aggregate({ where: { status: 'OPEN' }, _sum: { amountPaise: true }, _count: { _all: true } }),
    tab === 'payments' ? db.payment.findMany({ where: { status: 'PAID' }, orderBy: { paidAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }) : [],
    tab === 'payments' ? db.payment.count({ where: { status: 'PAID' } }) : 0,
    tab === 'dues' ? db.due.findMany({ where: { status: 'OPEN' }, orderBy: { dueDate: 'asc' } }) : [],
  ])
  const athleteIds = [...new Set([...payments.map((p) => p.athleteId), ...dues.map((d) => d.athleteId)])]
  const [athletes, invoices] = await Promise.all([
    athleteIds.length ? db.athlete.findMany({ where: { id: { in: athleteIds } }, select: { id: true, name: true, memberCode: true, phone: true, whatsappOptOut: true } }) : [],
    payments.length ? db.invoice.findMany({ where: { paymentId: { in: payments.map((p) => p.id) } }, select: { id: true, number: true, paymentId: true } }) : [],
  ])
  const pending = await pendingCounts(db)
  const athleteById = new Map(athletes.map((a) => [a.id, a]))
  const invoiceByPayment = new Map(invoices.map((i) => [i.paymentId, i]))
  const monthTotal = byMethod.reduce((sum, row) => sum + (row._sum.amountPaise ?? 0), 0)

  return (
    <StaffShell ctx={ctx} title="Payments and dues">
      <div className="sum-strip">
        <div>
          Collected this month<strong>{formatInr(monthTotal)}</strong>
        </div>
        {byMethod.map((row) => (
          <div key={row.method}>
            {row.method.toLowerCase()} ({row._count._all})<strong>{formatInr(row._sum.amountPaise ?? 0)}</strong>
          </div>
        ))}
        <div>
          Open dues ({dueTotal._count._all})<strong>{formatInr(dueTotal._sum.amountPaise ?? 0)}</strong>
        </div>
      </div>
      <div className="tab-links">
        <Link className={tab === 'payments' ? 'active' : ''} href="/owner/payments">
          Payments
        </Link>
        <Link className={tab === 'dues' ? 'active' : ''} href="/owner/payments?tab=dues">
          Dues
        </Link>
        <Link className={tab === 'claims' ? 'active' : ''} href="/owner/payments?tab=claims">
          UPI paid claims {pending.claims ? <span className="tab-count">{pending.claims}</span> : null}
        </Link>
        <Link className={tab === 'freeze' ? 'active' : ''} href="/owner/payments?tab=freeze">
          Freeze requests {pending.freezes ? <span className="tab-count">{pending.freezes}</span> : null}
        </Link>
      </div>
      {tab === 'claims' ? <ClaimsQueue db={db} memberHref={(id) => `/owner/members/${id}`} /> : null}
      {tab === 'freeze' ? <FreezeQueue db={db} memberHref={(id) => `/owner/members/${id}`} /> : null}

      {tab === 'payments' ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Member</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const athlete = athleteById.get(payment.athleteId)
                const invoice = invoiceByPayment.get(payment.id)
                return (
                  <tr key={payment.id}>
                    <td>{when(payment.paidAt)}</td>
                    <td>
                      <Link href={`/owner/members/${payment.athleteId}`}>{athlete?.name ?? '-'}</Link>
                      <span className="sub">{athlete?.memberCode}</span>
                    </td>
                    <td>{payment.method.toLowerCase()}</td>
                    <td className="num">{formatInr(payment.amountPaise)}</td>
                    <td>
                      {invoice ? (
                        <a className="btn btn-outline btn-sm" href={`/api/gym/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
                          <FileText /> {invoice.number}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {payments.length === 0 ? <div className="table-empty">No payments yet. Sell a plan from a member page.</div> : null}
          <Pager page={page} pages={Math.max(1, Math.ceil(paymentCount / PAGE_SIZE))} total={paymentCount} basePath="/owner/payments" params={{}} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Due date</th>
                <th className="num">Days</th>
                <th className="num">Amount</th>
                <th>Reminder stage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dues.map((due) => {
                const athlete = athleteById.get(due.athleteId)
                const days = Math.round((today.getTime() - due.dueDate.getTime()) / 86400000)
                return (
                  <tr key={due.id}>
                    <td>
                      <Link href={`/owner/members/${due.athleteId}`}>{athlete?.name ?? '-'}</Link>
                      <span className="sub">{athlete?.phone}</span>
                    </td>
                    <td>{formatIstDate(due.dueDate, { day: 'numeric', month: 'short' })}</td>
                    <td className="num">{days > 0 ? `${days} late` : days === 0 ? 'today' : `in ${-days}`}</td>
                    <td className="num">{formatInr(due.amountPaise)}</td>
                    <td>
                      {due.reminderStage ? (stageNames.get(due.reminderStage) ?? `Stage ${due.reminderStage}`) : 'Not reminded yet'}
                      <span className="sub">{due.lastRemindedAt ? `Last: ${when(due.lastRemindedAt)}` : athlete?.whatsappOptOut ? 'Opted out of WhatsApp' : ''}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <RemindButton dueId={due.id} disabled={athlete?.whatsappOptOut} reason={athlete?.whatsappOptOut ? 'This member replied STOP to WhatsApp messages' : undefined} />
                        <Link className="btn btn-dark btn-sm" href={`/owner/members/${due.athleteId}`}>
                          Collect
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {dues.length === 0 ? <div className="table-empty">No open dues.</div> : null}
          <p className="muted" style={{ padding: '0 16px 14px' }}>
            Automatic WhatsApp reminders with a pay link follow your stages in <Link href="/owner/settings/reminders">Settings &gt; Reminders</Link>. They stop as soon as a due is paid.
          </p>
        </div>
      )}
    </StaffShell>
  )
}
