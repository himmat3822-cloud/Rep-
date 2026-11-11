import Link from 'next/link'
import { StaffShell, type StaffPageContext } from '@/components/staff/staff-shell'
import { FeatureLocked } from '@/components/growth/locked'
import { CopyLink, LeadActions, LeadForm, ReopenLead } from '@/components/growth/actions'
import { SOURCE_LABEL, STAGE_LABEL } from '@/lib/growth-labels'
import { StatusBadge } from '@/components/kit/status-badge'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { leadFunnel } from '@/lib/owner/leads'
import { appUrl } from '@/lib/env'
import { addDays, formatIstDate, istStartOfDay } from '@/lib/time'

// Leads CRM screen shared by the owner (/owner/leads) and the front desk
// (/desk/leads). Views: today's follow-ups, the stage board, closed leads.

const VIEWS = [
  { key: 'today', label: 'Follow up today' },
  { key: 'board', label: 'All open' },
  { key: 'closed', label: 'Joined and lost' },
] as const
type View = (typeof VIEWS)[number]['key']

type LeadRow = {
  id: string
  name: string
  phone: string
  source: string
  stage: string
  interest: string
  notes: string
  nextFollowUpAt: Date | null
  lastContactAt: Date | null
  assignedToId: string | null
  convertedAthleteId: string | null
  lostReason: string | null
  createdAt: Date
}

export async function LeadsScreen({ ctx, view: rawView }: { ctx: StaffPageContext; view?: string }) {
  const base = ctx.user.kind === 'OWNER' ? '/owner' : '/desk'
  const features = await getGymFeatures(ctx.gym.id)
  if (!features.includes('leads_crm')) {
    return (
      <StaffShell ctx={ctx} title="Leads">
        <FeatureLocked title="Never lose a walk-in again" plan="Pro">
          Note every enquiry from walk-ins, Instagram, Google and referrals, get reminded to follow up, and turn a lead into a member in one click.
        </FeatureLocked>
      </StaffShell>
    )
  }
  const view: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : 'today'
  const db = tenantDb(ctx.gym.id)
  const endOfToday = addDays(istStartOfDay(), 1)
  const open = { stage: { in: ['NEW', 'TRIAL', 'FOLLOW_UP'] as ('NEW' | 'TRIAL' | 'FOLLOW_UP')[] } }
  const [leads, dueCount, openCount, staff, branches, funnel] = await Promise.all([
    view === 'today'
      ? db.lead.findMany({ where: { ...open, nextFollowUpAt: { lt: endOfToday } }, orderBy: { nextFollowUpAt: 'asc' }, take: 100 })
      : view === 'board'
        ? db.lead.findMany({ where: open, orderBy: [{ nextFollowUpAt: 'asc' }], take: 300 })
        : db.lead.findMany({ where: { stage: { in: ['JOINED', 'LOST'] } }, orderBy: { updatedAt: 'desc' }, take: 60 }),
    db.lead.count({ where: { ...open, nextFollowUpAt: { lt: endOfToday } } }),
    db.lead.count({ where: open }),
    db.gymUser.findMany({ where: { active: true, kind: { in: ['OWNER', 'DESK'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ctx.user.kind === 'OWNER' ? leadFunnel(db, addDays(istStartOfDay(), -90)) : Promise.resolve([]),
  ])
  const staffName = new Map(staff.map((s) => [s.id, s.name]))
  const enquiryUrl = `${appUrl()}/g/${ctx.gym.slug}/enquire`
  const totals = funnel.reduce((acc, f) => ({ total: acc.total + f.total, joined: acc.joined + f.joined }), { total: 0, joined: 0 })

  const card = (lead: LeadRow, actions = true) => {
    const overdue = lead.nextFollowUpAt && lead.nextFollowUpAt < istStartOfDay()
    return (
      <li key={lead.id} className="lead-card">
        <div className="lead-top">
          <div className="grow">
            <strong>{lead.name}</strong>
            <small>
              {lead.phone} - {SOURCE_LABEL[lead.source] ?? lead.source}
              {lead.interest ? ` - ${lead.interest}` : ''}
            </small>
          </div>
          <StatusBadge value={lead.stage === 'JOINED' ? 'APPROVED' : lead.stage === 'LOST' ? 'REJECTED' : lead.stage === 'TRIAL' ? 'TRIAL' : 'PENDING'} label={STAGE_LABEL[lead.stage]} />
        </div>
        <p className="lead-meta">
          {lead.nextFollowUpAt && actions ? <span className={overdue ? 'late' : ''}>Follow up {formatIstDate(lead.nextFollowUpAt, { day: 'numeric', month: 'short' })}</span> : null}
          {lead.lastContactAt ? <span>Last contact {formatIstDate(lead.lastContactAt, { day: 'numeric', month: 'short' })}</span> : <span>Added {formatIstDate(lead.createdAt, { day: 'numeric', month: 'short' })}</span>}
          {lead.assignedToId ? <span>With {staffName.get(lead.assignedToId) ?? 'staff'}</span> : null}
          {lead.lostReason ? <span>Lost: {lead.lostReason}</span> : null}
        </p>
        {lead.notes ? <pre className="lead-notes">{lead.notes.split('\n').slice(0, 3).join('\n')}</pre> : null}
        {actions ? <LeadActions lead={lead} branches={branches} /> : null}
        {lead.convertedAthleteId ? <Link className="text-button" href={`${base}/members/${lead.convertedAthleteId}`}>Open member</Link> : null}
        {lead.stage === 'LOST' ? <ReopenLead id={lead.id} /> : null}
      </li>
    )
  }

  return (
    <StaffShell ctx={ctx} title="Leads">
      <div className="two-col lead-layout">
        <section className="panel">
          <p className="kicker">ADD A LEAD</p>
          <h2>Someone walked in or called?</h2>
          <LeadForm staff={staff} compact={ctx.user.kind !== 'OWNER'} />
        </section>
        <section className="panel">
          {ctx.user.kind === 'OWNER' ? (
            <>
              <p className="kicker">LAST 90 DAYS</p>
              <h2>{totals.total ? `${Math.round((totals.joined / totals.total) * 100)}% of leads joined` : 'No leads yet'}</h2>
              <table className="mini-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Source</th><th className="num">Leads</th><th className="num">Joined</th><th className="num">Rate</th></tr>
                </thead>
                <tbody>
                  {funnel.map((f) => (
                    <tr key={f.source}><td>{SOURCE_LABEL[f.source] ?? f.source}</td><td className="num">{f.total}</td><td className="num">{f.joined}</td><td className="num">{f.conversion}%</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <p className="kicker">TODAY</p>
              <h2>{dueCount} follow-up(s) due</h2>
            </>
          )}
          <div className="enquiry-link">
            <p className="muted">Enquiry form for your Instagram bio, Google profile or website. New enquiries land here as Website leads.</p>
            <div className="row-actions">
              <code>{enquiryUrl.replace(/^https?:\/\//, '')}</code>
              <CopyLink url={enquiryUrl} />
            </div>
          </div>
        </section>
      </div>

      <div className="tab-links" style={{ margin: '20px 0 12px' }}>
        {VIEWS.map((v) => (
          <Link key={v.key} className={v.key === view ? 'active' : ''} href={`${base}/leads?view=${v.key}`}>
            {v.label}
            {v.key === 'today' && dueCount ? <span className="tab-count">{dueCount}</span> : v.key === 'board' ? <span className="tab-count">{openCount}</span> : null}
          </Link>
        ))}
      </div>

      {leads.length === 0 ? (
        <section className="panel empty-panel">
          <h2>{view === 'today' ? 'No follow-ups due today' : view === 'board' ? 'No open leads' : 'Nothing here yet'}</h2>
          <p>{view === 'today' ? 'Nice. Add walk-ins above so nobody is forgotten.' : 'Leads you add or that come from the enquiry form show up here.'}</p>
        </section>
      ) : view === 'board' ? (
        <div className="lead-board">
          {(['NEW', 'TRIAL', 'FOLLOW_UP'] as const).map((stage) => {
            const mine = leads.filter((l) => l.stage === stage)
            return (
              <section key={stage} className="lead-col">
                <h3>{STAGE_LABEL[stage]} <span className="tab-count">{mine.length}</span></h3>
                <ul>{mine.map((l) => card(l))}</ul>
              </section>
            )
          })}
        </div>
      ) : (
        <ul className="lead-list">{leads.map((l) => card(l, view !== 'closed'))}</ul>
      )}
    </StaffShell>
  )
}
