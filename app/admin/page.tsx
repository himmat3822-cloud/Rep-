import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, Building2, MessageCircle, Sparkles, TrendingDown, Wallet } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { BarChart } from '@/components/kit/bar-chart'
import { StatusBadge } from '@/components/kit/status-badge'
import { prisma } from '@/lib/db/client'
import { getPlatformAnalytics } from '@/lib/platform/analytics'
import { formatInr, formatInrCompact } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Platform - Rep+ Admin' }

export default async function AdminHomePage() {
  const data = await getPlatformAnalytics(prisma)
  const usagePct = data.whatsapp.quota ? Math.round((data.whatsapp.sent / data.whatsapp.quota) * 100) : 0

  return (
    <AdminFrame title="Platform">
      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-icon"><Building2 /></div>
          <div className="metric-copy"><span>Total gyms</span><strong>{data.totalGyms}</strong><small>{data.byStatus.ACTIVE} active, {data.byStatus.TRIAL} on trial</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><Wallet /></div>
          <div className="metric-copy"><span>MRR (excl. GST)</span><strong>{formatInr(data.mrrPaise)}</strong><small>ARR {formatInrCompact(data.arrPaise)}</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><TrendingDown /></div>
          <div className="metric-copy"><span>Churned</span><strong>{data.churned}</strong><small>Suspended or cancelled</small></div>
        </div>
      </div>
      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-icon orange"><AlertTriangle /></div>
          <div className="metric-copy"><span>Unpaid right now</span><strong>{data.byStatus.PAST_DUE + data.byStatus.READ_ONLY}</strong><small>{data.byStatus.PAST_DUE} past due, {data.byStatus.READ_ONLY} read-only</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon"><MessageCircle /></div>
          <div className="metric-copy"><span>WhatsApp this month</span><strong>{data.whatsapp.sent.toLocaleString('en-IN')}</strong><small>{usagePct}% of {data.whatsapp.quota.toLocaleString('en-IN')} total quota</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><Sparkles /></div>
          <div className="metric-copy"><span>Trials</span><strong>{data.byStatus.TRIAL}</strong><small>Convert them before day 14</small></div>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-heading">
            <div><p className="kicker">PAID INVOICES, EXCL. GST</p><h2>Revenue, last 12 months</h2></div>
            <a className="btn btn-outline btn-sm" href="/api/admin/export/payments">CSV</a>
          </div>
          <BarChart points={data.revenue} format={(value) => formatInrCompact(value)} />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div><p className="kicker">GROWTH</p><h2>New gyms per month</h2></div>
            <a className="btn btn-outline btn-sm" href="/api/admin/export/gyms">CSV</a>
          </div>
          <BarChart points={data.newGyms.slice(-6)} />
        </section>
      </div>

      <div className="two-col" style={{ marginTop: 18 }}>
        <section className="panel">
          <div className="panel-heading">
            <div><p className="kicker accent-kicker">NEEDS ATTENTION</p><h2>Overdue gyms</h2></div>
            <Link className="btn btn-outline btn-sm" href="/admin/billing">Billing</Link>
          </div>
          <div className="list-rows">
            {data.overdue.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>Everyone has paid. Nice.</p> : null}
            {data.overdue.map((row) => (
              <div className="list-row" key={row.gymId}>
                <span>
                  <Link href={`/admin/gyms/${row.gymId}`}>{row.name}</Link>
                  <br />
                  <small>{row.since ? `since ${formatIstDate(row.since, { day: 'numeric', month: 'short' })}` : ''}</small>
                </span>
                <StatusBadge value={row.status} />
              </div>
            ))}
            {data.purgeDue.map((row) => (
              <div className="list-row" key={`purge-${row.gymId}`}>
                <span>
                  <Link href={`/admin/gyms/${row.gymId}`}>{row.name}</Link>
                  <br />
                  <small>90-day retention ended - data can be purged</small>
                </span>
                <span className="badge badge-red">Purge due</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div><p className="kicker">THIS MONTH</p><h2>WhatsApp usage</h2></div>
          </div>
          <div className="list-rows">
            {data.whatsapp.top.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No messages sent yet this month.</p> : null}
            {data.whatsapp.top.map((row) => {
              const pct = row.quota ? Math.min(100, Math.round((row.sent / row.quota) * 100)) : 0
              return (
                <div className="list-row" key={row.gymId}>
                  <span>
                    <Link href={`/admin/gyms/${row.gymId}`}>{row.name}</Link>
                    <div className={`usage-bar ${pct >= 80 ? 'warn' : ''}`}><span style={{ width: `${pct}%` }} /></div>
                  </span>
                  <small>{row.sent.toLocaleString('en-IN')} / {row.quota.toLocaleString('en-IN')}</small>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </AdminFrame>
  )
}
