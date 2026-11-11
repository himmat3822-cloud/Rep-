import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageCircle, Settings2 } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { Pager } from '@/components/kit/pager'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { whatsappConfigured } from '@/lib/integrations/whatsapp'
import { monthKey, usagePercent } from '@/lib/messaging/policy'
import { pickDueStages } from '@/lib/messaging/dues'
import { isSameDayOfYear } from '@/lib/messaging/scheduled'
import { TEMPLATES, isTemplateName } from '@/lib/messaging/templates'
import { messageLogQuerySchema } from '@/lib/validation/messaging'
import { maskPhone } from '@/lib/phone'
import { addDays, daysBetween, formatIstDate, istDateOnly, istParts, istStartOfMonth } from '@/lib/time'

export const metadata: Metadata = { title: 'WhatsApp and reminders - Rep+' }

const PAGE_SIZE = 40

const PURPOSES: Record<string, string> = {
  due_reminder: 'Dues reminder',
  due_manual: 'Dues reminder (sent by you)',
  due_owner_alert: 'Owner alert',
  renewal: 'Plan ending soon',
  slot_reminder: 'Slot reminder',
  birthday: 'Birthday wish',
  anniversary: 'Anniversary',
  weekly_report: 'Weekly report card',
  otp: 'Login code (OTP)',
}

const when = (date: Date) => formatIstDate(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const parsed = messageLogQuerySchema.safeParse(await searchParams)
  const query = parsed.success ? parsed.data : { page: 1, purpose: undefined, status: undefined }
  const db = tenantDb(ctx.gym.id)
  const monthStart = istStartOfMonth()
  const today = istDateOnly()
  const where = { ...(query.purpose ? { purpose: query.purpose } : {}), ...(query.status ? { status: query.status } : {}) }

  const [config, subscription, override, usage, byStatus, byPurpose, logs, total, optedOut, stages, openDues, birthdays, renewals] = await Promise.all([
    loadGymConfig(db, ctx.gym.id),
    db.gymSubscription.findFirst({ select: { plan: { select: { whatsappQuota: true, name: true } } } }),
    db.gymOverride.findFirst({ select: { whatsappTopUp: true } }),
    db.whatsAppUsage.findFirst({ where: { month: monthKey() } }),
    db.messageLog.groupBy({ by: ['status'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
    db.messageLog.groupBy({ by: ['purpose'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
    db.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.messageLog.count({ where }),
    db.athlete.count({ where: { whatsappOptOut: true, archived: false } }),
    db.reminderStage.findMany({ where: { enabled: true }, orderBy: { stage: 'asc' } }),
    db.due.findMany({ where: { status: 'OPEN', dueDate: { gte: addDays(today, -30), lte: addDays(today, 10) } }, select: { dueDate: true, reminderStage: true } }),
    db.athlete.findMany({ where: { archived: false, dateOfBirth: { not: null } }, select: { dateOfBirth: true } }),
    db.membership.count({ where: { status: 'ACTIVE', endsAt: { gte: today, lte: addDays(today, 7) } } }),
  ])

  const quota = (subscription?.plan.whatsappQuota ?? 0) + (override?.whatsappTopUp ?? 0)
  const sent = usage?.sent ?? 0
  const percent = usagePercent(sent, quota)
  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0
  const delivered = count('DELIVERED') + count('READ')
  const outgoing = count('SENT') + delivered
  const m = config.settings.messaging
  const parts = istParts()
  const duesToday = m.duesAuto ? openDues.filter((due) => { const pick = pickDueStages(stages, due.reminderStage, daysBetween(due.dueDate, today)); return pick.member || pick.owner }).length : 0
  const birthdaysToday = m.birthdayWishes ? birthdays.filter((row) => row.dateOfBirth && isSameDayOfYear(row.dateOfBirth, parts)).length : 0
  const live = whatsappConfigured()
  const names = new Map<string, string>()
  const athleteIds = [...new Set(logs.map((log) => log.athleteId).filter((id): id is string => Boolean(id)))]
  const staffIds = [...new Set(logs.map((log) => log.staffId).filter((id): id is string => Boolean(id)))]
  const [athletes, staff] = await Promise.all([
    athleteIds.length ? db.athlete.findMany({ where: { id: { in: athleteIds } }, select: { id: true, name: true } }) : [],
    staffIds.length ? db.gymUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [],
  ])
  for (const row of [...athletes, ...staff]) names.set(row.id, row.name)

  return (
    <StaffShell ctx={ctx} title="WhatsApp and reminders">
      <div className="two-col msg-top">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">WHATSAPP THIS MONTH</p>
              <h2>
                {sent.toLocaleString('en-IN')} of {quota.toLocaleString('en-IN')} messages used
              </h2>
            </div>
            <Link className="btn btn-outline btn-sm" href="/owner/settings/reminders">
              <Settings2 /> Reminder settings
            </Link>
          </div>
          <div className={`meter quota-meter ${percent >= 100 ? 'full' : percent >= 80 ? 'warn' : ''}`}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="muted">
            {percent >= 100
              ? 'Limit reached. Only login codes go out until the 1st. Ask Rep+ for a top-up or upgrade your plan.'
              : percent >= 90
                ? 'Over 90%: birthday wishes, anniversaries and weekly reports are paused so dues reminders keep going.'
                : percent >= 80
                  ? 'Over 80% used. Keep an eye on it.'
                  : `${subscription?.plan.name ?? 'Your'} plan. Resets on the 1st. Login codes are never blocked.`}
            {usage?.blocked ? ` ${usage.blocked} message(s) were held back this month.` : ''}
          </p>
          <div className="sum-strip" style={{ marginTop: 16, marginBottom: 0 }}>
            <div>
              Sent<strong>{outgoing}</strong>
            </div>
            <div>
              Delivered<strong>{delivered}</strong>
            </div>
            <div>
              Read<strong>{count('READ')}</strong>
            </div>
            <div>
              Failed<strong>{count('FAILED')}</strong>
            </div>
            <div>
              Held (limit)<strong>{count('BLOCKED')}</strong>
            </div>
            <div>
              Opted out (STOP)<strong>{optedOut}</strong>
            </div>
          </div>
          {!live ? (
            <p className="notice" style={{ marginTop: 14 }}>
              <MessageCircle /> WhatsApp is not connected on this server yet, so messages are logged here and printed to the server console instead of being sent.
            </p>
          ) : null}
        </section>

        <section className="panel">
          <p className="kicker">LINED UP FOR TODAY</p>
          <h2>Automatic messages</h2>
          <ul className="lineup">
            <li>
              <span>Dues reminders</span>
              <strong>{m.duesAuto ? duesToday : 'off'}</strong>
            </li>
            <li>
              <span>Plans ending in 7 days</span>
              <strong>{m.renewalReminders ? renewals : 'off'}</strong>
            </li>
            <li>
              <span>Birthdays</span>
              <strong>{m.birthdayWishes ? birthdaysToday : 'off'}</strong>
            </li>
            <li>
              <span>Weekly report cards</span>
              <strong>{m.weeklyReport ? 'Sunday 6 PM' : 'off'}</strong>
            </li>
          </ul>
          <p className="muted">
            Daily messages go out from {((m.sendHour + 11) % 12) + 1}:00 {m.sendHour < 12 ? 'AM' : 'PM'}. Never between 9 PM and 8 AM.
          </p>
          <div className="purpose-list">
            {byPurpose.map((row) => (
              <span key={row.purpose}>
                {PURPOSES[row.purpose] ?? row.purpose} <strong>{row._count._all}</strong>
              </span>
            ))}
          </div>
        </section>
      </div>

      <form className="filter-row" method="get">
        <select name="purpose" defaultValue={query.purpose ?? ''}>
          <option value="">All messages</option>
          {Object.entries(PURPOSES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={query.status ?? ''}>
          <option value="">Any status</option>
          {['SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED'].map((status) => (
            <option key={status} value={status}>
              {status.toLowerCase()}
            </option>
          ))}
        </select>
        <button className="btn btn-dark btn-sm">Filter</button>
      </form>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>Message</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const person = (log.athleteId && names.get(log.athleteId)) || (log.staffId && names.get(log.staffId)) || '-'
              return (
                <tr key={log.id}>
                  <td>{when(log.createdAt)}</td>
                  <td>
                    {log.athleteId ? <Link href={`/owner/members/${log.athleteId}`}>{person}</Link> : person}
                    <span className="sub">
                      {log.toPhone ? maskPhone(log.toPhone) : ''} {log.staffId ? '- you / staff' : ''}
                    </span>
                  </td>
                  <td className="msg-cell">
                    <strong>{PURPOSES[log.purpose] ?? (isTemplateName(log.template) ? TEMPLATES[log.template].label : log.template)}</strong>
                    <span className="sub">
                      {log.language} - {log.body ?? log.template}
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={log.status} />
                    {log.error ? <span className="sub">{log.error}</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {logs.length === 0 ? <div className="table-empty">No messages yet. Reminders start going out once members have dues, bookings or birthdays.</div> : null}
        <Pager page={query.page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} basePath="/owner/messages" params={{ purpose: query.purpose, status: query.status }} />
      </div>
    </StaffShell>
  )
}
