import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { FeatureLocked } from '@/components/growth/locked'
import { DeleteExpense, ExpenseForm, InsightsPanel } from '@/components/growth/actions'
import { CATEGORY_LABEL, SOURCE_LABEL } from '@/lib/growth-labels'
import { BarChart } from '@/components/kit/bar-chart'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { attendanceReport, duesReport, leadsReport, membersReport, profitReport, ptReport, revenueReport } from '@/lib/owner/reports'
import { formatInr, formatInrCompact } from '@/lib/money'
import { formatHour, formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Reports - Rep+' }

const TABS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'members', label: 'Members' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'dues', label: 'Dues' },
  { key: 'leads', label: 'Leads' },
  { key: 'pt', label: 'PT' },
  { key: 'profit', label: 'Expenses and profit' },
  { key: 'insights', label: 'AI insights' },
] as const
type Tab = (typeof TABS)[number]['key']
const short = (label: string) => label.split(' ')[0]

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; months?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const sp = await searchParams
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'revenue'
  const months = [3, 6, 12].includes(Number(sp.months)) ? Number(sp.months) : 6
  const features = await getGymFeatures(ctx.gym.id)
  const db = tenantDb(ctx.gym.id)
  const href = (t: Tab, m = months) => `/owner/reports?tab=${t}&months=${m}`
  const csv = (kind: string) => (
    <a className="btn btn-outline btn-sm" href={`/api/gym/reports/${kind}.csv?months=${months}`} download>
      <Download /> CSV
    </a>
  )

  let body: React.ReactNode = null
  if (!features.includes('basic_reports')) {
    body = <FeatureLocked title="Reports" plan="Pro">Monthly revenue, members, attendance and dues with CSV export.</FeatureLocked>
  } else if (tab === 'revenue') {
    const rows = await revenueReport(db, months)
    const total = rows.reduce((s, r) => s + r.total, 0)
    body = (
      <section className="panel">
        <div className="panel-heading">
          <div><p className="kicker">COLLECTED</p><h2>{formatInr(total)} in {months} months</h2></div>
          {csv('revenue')}
        </div>
        <BarChart points={rows.map((r) => ({ label: short(r.month), value: r.total }))} format={formatInrCompact} />
        <div className="table-wrap flat">
          <table className="data-table">
            <thead><tr><th>Month</th><th className="num">Cash</th><th className="num">UPI</th><th className="num">Card</th><th className="num">Bank</th><th className="num">GST</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}><td>{r.month}<span className="sub">{r.payments} payments</span></td><td className="num">{formatInr(r.cash)}</td><td className="num">{formatInr(r.upi)}</td><td className="num">{formatInr(r.card)}</td><td className="num">{formatInr(r.bank)}</td><td className="num">{formatInr(r.gst)}</td><td className="num"><strong>{formatInr(r.total)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  } else if (tab === 'members') {
    const rows = await membersReport(db, months)
    body = (
      <section className="panel">
        <div className="panel-heading">
          <div><p className="kicker">MEMBERS</p><h2>{rows.at(-1)?.activeAtEnd ?? 0} active now</h2></div>
          {csv('members')}
        </div>
        <BarChart points={rows.map((r) => ({ label: short(r.month), value: r.activeAtEnd }))} />
        <div className="table-wrap flat">
          <table className="data-table">
            <thead><tr><th>Month</th><th className="num">Joined</th><th className="num">Renewed</th><th className="num">Expired</th><th className="num">Active at end</th><th className="num">Churn</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}><td>{r.month}</td><td className="num">{r.joined}</td><td className="num">{r.renewed}</td><td className="num">{r.expired}</td><td className="num">{r.activeAtEnd}</td><td className="num">{r.churnPct}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>Churn = plans that ended in the month and were not renewed, as a share of members active at the start.</p>
      </section>
    )
  } else if (tab === 'attendance') {
    const report = await attendanceReport(db, months)
    const peak = [...report.hours].sort((a, b) => b.visits - a.visits)[0]
    body = (
      <div className="two-col">
        <section className="panel">
          <div className="panel-heading">
            <div><p className="kicker">VISITS PER MONTH</p><h2>{report.months.at(-1)?.perDay ?? 0} a day this month</h2></div>
            {csv('attendance')}
          </div>
          <BarChart points={report.months.map((r) => ({ label: short(r.month), value: r.visits }))} />
          <table className="mini-table">
            <thead><tr><th>Month</th><th className="num">Visits</th><th className="num">Members</th><th className="num">Per day</th></tr></thead>
            <tbody>{report.months.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{r.visits}</td><td className="num">{r.members}</td><td className="num">{r.perDay}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <p className="kicker">BY HOUR, LAST 30 DAYS</p>
          <h2>{peak ? `Busiest at ${formatHour(peak.hour)}` : 'No visits yet'}</h2>
          <BarChart points={report.hours.map((h) => ({ label: formatHour(h.hour).replace(/:00| /g, ''), value: h.visits }))} highlightLast={false} />
          <p className="muted">Detailed heatmaps are on the Attendance page.</p>
        </section>
      </div>
    )
  } else if (tab === 'dues') {
    const report = await duesReport(db)
    const total = report.aging.reduce((s, a) => s + a.amount, 0)
    body = (
      <section className="panel">
        <div className="panel-heading">
          <div><p className="kicker">OPEN DUES</p><h2>{formatInr(total)} to collect</h2></div>
          {csv('dues')}
        </div>
        <div className="aging-grid">
          {report.aging.map((a, i) => (
            <div key={a.bucket} className={i >= 3 ? 'bad' : i >= 1 ? 'warn' : ''}>
              <small>{a.bucket}</small>
              <strong>{formatInr(a.amount)}</strong>
              <span>{a.count} due(s)</span>
            </div>
          ))}
        </div>
        <div className="table-wrap flat">
          <table className="data-table">
            <thead><tr><th>Member</th><th>Due date</th><th className="num">Days late</th><th className="num">Reminders</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {report.rows.slice(0, 50).map((r, i) => (
                <tr key={`${r.memberCode}-${i}`}><td>{r.member}<span className="sub">{r.memberCode}</span></td><td>{r.dueDate}</td><td className="num">{r.daysLate}</td><td className="num">{r.reminderStage}</td><td className="num">{formatInr(r.amountPaise)}</td></tr>
              ))}
            </tbody>
          </table>
          {report.rows.length > 50 ? <p className="muted" style={{ padding: '0 16px 14px' }}>Showing 50 of {report.rows.length}. Download the CSV for all.</p> : null}
        </div>
      </section>
    )
  } else if (tab === 'leads') {
    if (!features.includes('leads_crm')) body = <FeatureLocked title="Lead conversion" plan="Pro">Which source brings members who actually join.</FeatureLocked>
    else {
      const report = await leadsReport(db, months)
      body = (
        <div className="two-col">
          <section className="panel">
            <div className="panel-heading">
              <div><p className="kicker">BY SOURCE</p><h2>Where members come from</h2></div>
              {csv('leads')}
            </div>
            <table className="mini-table" style={{ marginTop: 12 }}>
              <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Trial</th><th className="num">Joined</th><th className="num">Lost</th><th className="num">Rate</th></tr></thead>
              <tbody>{report.funnel.map((f) => <tr key={f.source}><td>{SOURCE_LABEL[f.source] ?? f.source}</td><td className="num">{f.total}</td><td className="num">{f.trial}</td><td className="num">{f.joined}</td><td className="num">{f.lost}</td><td className="num"><strong>{f.conversion}%</strong></td></tr>)}</tbody>
            </table>
          </section>
          <section className="panel">
            <p className="kicker">NEW LEADS PER MONTH</p>
            <h2>{report.monthly.reduce((s, m) => s + m.leads, 0)} leads, {report.monthly.reduce((s, m) => s + m.joined, 0)} joined</h2>
            <BarChart points={report.monthly.map((m) => ({ label: short(m.month), value: m.leads }))} />
          </section>
        </div>
      )
    }
  } else if (tab === 'pt') {
    const rows = await ptReport(db, months)
    body = (
      <section className="panel">
        <div className="panel-heading">
          <div><p className="kicker">PERSONAL TRAINING</p><h2>{rows.reduce((s, r) => s + r.confirmed, 0)} confirmed sessions</h2></div>
          {csv('pt')}
        </div>
        <div className="table-wrap flat">
          <table className="data-table">
            <thead><tr><th>Month</th><th>Trainer</th><th className="num">Logged</th><th className="num">Confirmed</th><th className="num">Commission</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={5} className="table-empty">No PT sessions in this period.</td></tr> : null}
              {rows.map((r) => <tr key={`${r.month}-${r.trainer}`}><td>{r.month}</td><td>{r.trainer}</td><td className="num">{r.sessions}</td><td className="num">{r.confirmed}</td><td className="num">{formatInr(r.commissionPaise)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    )
  } else if (tab === 'profit') {
    if (!features.includes('expenses_profit')) {
      body = <FeatureLocked title="Know your real profit" plan="Elite">Add rent, salaries, electricity and other expenses and see profit per month next to what you collected.</FeatureLocked>
    } else {
      const [rows, expenses, branches] = await Promise.all([
        profitReport(db, months),
        db.expense.findMany({ orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }], take: 12 }),
        db.branch.findMany({ where: { archived: false }, select: { id: true, name: true } }),
      ])
      const current = rows.at(-1)
      body = (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div><p className="kicker">PROFIT (BEFORE TAX)</p><h2>{current ? `${formatInr(current.profit)} this month so far` : ''}</h2></div>
              {csv('expenses')}
            </div>
            <BarChart points={rows.map((r) => ({ label: short(r.month), value: Math.max(0, r.profit) }))} format={formatInrCompact} />
            <div className="table-wrap flat">
              <table className="data-table">
                <thead><tr><th>Month</th><th className="num">Revenue ex-GST</th><th className="num">Expenses</th><th className="num">PT commission</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}<span className="sub">{Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${CATEGORY_LABEL[k] ?? k} ${formatInrCompact(v)}`).join(', ')}</span></td>
                      <td className="num">{formatInr(r.revenue)}</td>
                      <td className="num">{formatInr(r.expenses)}</td>
                      <td className="num">{formatInr(r.commission)}</td>
                      <td className={`num ${r.profit < 0 ? 'neg' : ''}`}><strong>{formatInr(r.profit)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 18 }}>
            <p className="kicker">EXPENSES</p>
            <h2>Add an expense</h2>
            <ExpenseForm branches={branches} />
            <ul className="t-list" style={{ marginTop: 12 }}>
              {expenses.map((e) => (
                <li key={e.id}>
                  <span className="tag">{CATEGORY_LABEL[e.category] ?? e.category}</span>
                  <span className="grow">{formatInr(e.amountPaise)}<small>{formatIstDate(e.spentOn, { day: 'numeric', month: 'short', year: 'numeric' })}{e.note ? ` - ${e.note}` : ''}</small></span>
                  <DeleteExpense id={e.id} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )
    }
  } else if (tab === 'insights') {
    body = features.includes('ai_insights') ? (
      <section className="panel">
        <p className="kicker">AI INSIGHTS</p>
        <h2>What to do this week</h2>
        <p className="muted" style={{ margin: '6px 0 14px' }}>Rep+ looks at collections, renewals, dues, attendance and leads and suggests a few concrete actions. Your numbers stay in Rep+; only totals are sent to the AI.</p>
        <InsightsPanel />
      </section>
    ) : (
      <FeatureLocked title="AI insights" plan="Elite">Plain-language advice from your gym&apos;s numbers every week: who to call, which slot to fill, which lead source works.</FeatureLocked>
    )
  }

  return (
    <StaffShell ctx={ctx} title="Reports">
      <div className="row-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="tab-links" style={{ margin: 0 }}>
          {TABS.map((t) => (
            <Link key={t.key} className={t.key === tab ? 'active' : ''} href={href(t.key)}>{t.label}</Link>
          ))}
        </div>
        {tab !== 'insights' && tab !== 'dues' ? (
          <div className="seg small">
            {[3, 6, 12].map((m) => (
              <Link key={m} className={m === months ? 'on' : ''} href={href(tab, m)}>{m} months</Link>
            ))}
          </div>
        ) : null}
      </div>
      {body}
    </StaffShell>
  )
}
