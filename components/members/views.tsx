import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Plus, Search } from 'lucide-react'
import { initials } from '@/components/brand'
import { StatusBadge } from '@/components/kit/status-badge'
import { Pager } from '@/components/kit/pager'
import { StaffShell, type StaffPageContext } from '@/components/staff/staff-shell'
import { ComingSoon } from '@/components/shell/coming-soon'
import { tenantDb } from '@/lib/db/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { getGymFeatures } from '@/lib/gym/features'
import { getMemberProfile, listMembers, MEMBER_STATUSES } from '@/lib/owner/members'
import { memberListQuerySchema } from '@/lib/validation/owner'
import { formatInr } from '@/lib/money'
import { addDays, formatIstDate, istDateOnly } from '@/lib/time'
import { MemberForm, type MemberFormOptions } from './member-form'
import { MoneyPanel } from './money-panel'
import { ArchiveButton, MemberSearch } from './member-bits'

// Member screens shared by owner (/owner/...) and front desk (/desk/...).

const STATUS_LABEL: Record<string, string> = { NEW: 'New', REGULAR: 'Regular', SLIPPING: 'Slipping', INACTIVE: 'Inactive', EXPIRED: 'Expired', FROZEN: 'Frozen' }
const quickAddHref = (base: string) => (base === '/owner' ? '/owner/desk/quick-add' : '/desk/quick-add')
const shortDate = (date: Date | null | undefined) => (date ? formatIstDate(date, { day: 'numeric', month: 'short', year: '2-digit' }) : '-')

async function featureGate(ctx: StaffPageContext) {
  const features = await getGymFeatures(ctx.gym.id)
  return features.includes('member_records')
}

export async function formOptions(ctx: StaffPageContext): Promise<MemberFormOptions> {
  const db = tenantDb(ctx.gym.id)
  const [branches, trainers] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    db.gymUser.findMany({ where: { active: true, kind: 'TRAINER' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  return { branches, trainers, label: ctx.gym.athleteLabel }
}

export async function MembersListView({ ctx, base, searchParams }: { ctx: StaffPageContext; base: string; searchParams: Record<string, string | undefined> }) {
  const label = ctx.gym.athleteLabelPlural
  if (!(await featureGate(ctx))) {
    return (
      <StaffShell ctx={ctx} title={label}>
        <ComingSoon title="Not in your plan" text="Member records are not part of your current Rep+ plan." items={['Upgrade from Rep+ billing']} />
      </StaffShell>
    )
  }
  const parsed = memberListQuerySchema.safeParse(searchParams)
  const filter = parsed.success ? parsed.data : { page: 1 }
  const result = await listMembers(tenantDb(ctx.gym.id), filter)
  const total = Object.values(result.counts).reduce((sum, value) => sum + (value ?? 0), 0)
  const chip = (status?: string) => {
    const query = new URLSearchParams()
    if (filter.q) query.set('q', filter.q)
    if (status) query.set('status', status)
    return `${base}/members${query.toString() ? `?${query}` : ''}`
  }
  const canWrite = hasPermission(ctx.claims.perms, 'members.write')

  return (
    <StaffShell ctx={ctx} title={label}>
      <div className="page-head">
        <form className="toolbar" method="get">
          <input name="q" defaultValue={filter.q ?? ''} placeholder="Search name, phone or member ID" aria-label="Search" />
          {filter.status ? <input type="hidden" name="status" value={filter.status} /> : null}
          <button className="btn btn-dark" type="submit">
            <Search /> Search
          </button>
        </form>
        {canWrite ? (
          <Link className="btn btn-lime" href={`${base}/members/new`}>
            <Plus /> Add {ctx.gym.athleteLabel.toLowerCase()}
          </Link>
        ) : null}
      </div>
      <div className="chip-row">
        <Link className={!filter.status ? 'active' : ''} href={chip()}>
          All<span>{total}</span>
        </Link>
        {MEMBER_STATUSES.map((status) => (
          <Link key={status} className={filter.status === status ? 'active' : ''} href={chip(status)}>
            {STATUS_LABEL[status]}
            <span>{result.counts[status] ?? 0}</span>
          </Link>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{ctx.gym.athleteLabel}</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Ends</th>
              <th>Last visit</th>
              <th className="num">Streak</th>
              <th className="num">Due</th>
              <th>Trainer</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`${base}/members/${row.id}`}>{row.name}</Link>
                  <span className="sub">
                    {row.memberCode} - {row.phone}
                  </span>
                </td>
                <td>
                  <StatusBadge value={row.status} label={STATUS_LABEL[row.status]} />
                </td>
                <td>{row.planName ?? '-'}</td>
                <td>{shortDate(row.endsAt)}</td>
                <td>{row.lastVisitAt ? shortDate(row.lastVisitAt) : 'Never'}</td>
                <td className="num">{row.streakDays}</td>
                <td className="num">{row.duePaise ? formatInr(row.duePaise) : '-'}</td>
                <td>{row.trainerName ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.rows.length === 0 ? <div className="table-empty">No {label.toLowerCase()} match. Try another search or add someone new.</div> : null}
        <Pager page={result.page} pages={result.pages} total={result.total} basePath={`${base}/members`} params={{ q: filter.q, status: filter.status }} />
      </div>
    </StaffShell>
  )
}

export async function NewMemberView({ ctx, base, compact }: { ctx: StaffPageContext; base: string; compact: boolean }) {
  const options = await formOptions(ctx)
  return (
    <StaffShell ctx={ctx} title={compact ? 'Quick add' : `Add ${ctx.gym.athleteLabel.toLowerCase()}`}>
      <div style={{ maxWidth: 860 }}>
        <p className="muted" style={{ marginBottom: 14 }}>
          {compact ? 'Name, number and branch are enough. You can fill the rest later.' : 'They log in to the app with this WhatsApp number - no password needed.'}
        </p>
        <MemberForm mode="create" options={options} base={base} compact={compact} />
      </div>
    </StaffShell>
  )
}

export function CollectView({ ctx, base }: { ctx: StaffPageContext; base: string }) {
  return (
    <StaffShell ctx={ctx} title="Collect payment">
      <div style={{ maxWidth: 720 }}>
        <MemberSearch base={base} label={ctx.gym.athleteLabel} />
        <p className="muted" style={{ marginTop: 12 }}>
          New person? <Link href={quickAddHref(base)}>Quick add</Link> them first.
        </p>
      </div>
    </StaffShell>
  )
}

export async function MemberProfileView({ ctx, base, id, openSell }: { ctx: StaffPageContext; base: string; id: string; openSell: boolean }) {
  const db = tenantDb(ctx.gym.id)
  const perms = ctx.claims.perms
  const canSeeMoney = hasPermission(perms, 'payments.read')
  const profile = await getMemberProfile(db, id, { canSeeMoney, isTrainer: ctx.user.kind === 'TRAINER' })
  if (!profile) notFound()
  const { athlete, current } = profile
  const options = await formOptions(ctx)
  const branchName = options.branches.find((branch) => branch.id === athlete.homeBranchId)?.name ?? '-'
  const trainerName = options.trainers.find((trainer) => trainer.id === athlete.trainerId)?.name ?? 'No trainer'
  const today = istDateOnly()
  const daysLeft = current ? Math.round((current.endsAt.getTime() - today.getTime()) / 86400000) : null
  const visitSet = new Set(profile.visitDays)
  const grid = Array.from({ length: 60 }, (_, index) => addDays(today, index - 59).toISOString().slice(0, 10))
  const frozenNow = current?.frozenFrom && current.frozenUntil && current.frozenFrom <= today && current.frozenUntil >= today

  return (
    <StaffShell ctx={ctx} title={athlete.name} kicker={ctx.gym.athleteLabelPlural}>
      <div className="member-head">
        <div className="big-avatar">{initials(athlete.name)}</div>
        <div>
          <h1>{athlete.name}</h1>
          <p>
            {athlete.memberCode} - {athlete.phone} - {branchName} - {trainerName} - joined {shortDate(athlete.joinedAt)}
          </p>
        </div>
        <div className="toolbar">
          <StatusBadge value={athlete.archived ? 'CANCELLED' : athlete.status} label={athlete.archived ? 'Archived' : STATUS_LABEL[athlete.status]} />
          {hasPermission(perms, 'members.delete') ? <ArchiveButton memberId={athlete.id} archived={athlete.archived} /> : null}
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          <div className="plan-hero">
            <p className="kicker">CURRENT PLAN</p>
            {current ? (
              <>
                <h2>{current.plan?.name ?? 'Membership'}</h2>
                <p>
                  {shortDate(current.startsAt)} to {shortDate(current.endsAt)}
                  {frozenNow ? ` - frozen till ${shortDate(current.frozenUntil)}` : ''}
                </p>
                <div className="big">
                  {daysLeft}
                  <small>days left</small>
                </div>
              </>
            ) : (
              <>
                <h2>No active plan</h2>
                <p>Sell a plan from the panel to activate the app and check-ins.</p>
              </>
            )}
          </div>

          <section className="panel">
            <p className="kicker">LAST 60 DAYS</p>
            <h2>
              {profile.visits90} visits in 90 days - streak {athlete.streakDays}
            </h2>
            <div className="visit-grid">
              {grid.map((day, index) => (
                <span key={day} className={`${visitSet.has(day) ? 'on' : ''} ${index === grid.length - 1 ? 'today' : ''}`} title={day} />
              ))}
            </div>
          </section>

          {canSeeMoney ? (
            <section className="panel">
              <p className="kicker">MONEY</p>
              <h2>Payments and invoices</h2>
              <div className="list-rows">
                {profile.payments.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No payments yet.</p> : null}
                {profile.payments.map((payment) => (
                  <div className="list-row" key={payment.id}>
                    <span>
                      <strong>{formatInr(payment.amountPaise)}</strong> <small>by {payment.method.toLowerCase()}</small>
                      <br />
                      <small>{payment.paidAt ? formatIstDate(payment.paidAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</small>
                    </span>
                    {payment.invoice ? (
                      <a className="btn btn-outline btn-sm" href={`/api/gym/invoices/${payment.invoice.id}/pdf`} target="_blank" rel="noreferrer">
                        <FileText /> {payment.invoice.number}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <p className="kicker">HISTORY</p>
            <h2>Memberships</h2>
            <div className="list-rows">
              {profile.memberships.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No memberships yet.</p> : null}
              {profile.memberships.map((membership) => (
                <div className="list-row" key={membership.id}>
                  <span>
                    <strong>{membership.planName}</strong>
                    <br />
                    <small>
                      {shortDate(membership.startsAt)} to {shortDate(membership.endsAt)}
                      {membership.freezeDaysUsed ? ` - frozen ${membership.freezeDaysUsed} day(s)` : ''}
                    </small>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    {canSeeMoney ? formatInr(membership.pricePaise) : null}
                    <br />
                    <StatusBadge value={membership.endsAt < today ? 'CANCELLED' : membership.status === 'PENDING' ? 'TRIAL' : 'ACTIVE'} label={membership.endsAt < today ? 'Ended' : membership.status === 'PENDING' ? 'Upcoming' : 'Active'} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="stack">
          {canSeeMoney || hasPermission(perms, 'payments.collect') ? (
            <MoneyPanel
              memberId={athlete.id}
              plans={profile.plans.filter((plan) => plan.active).map((plan) => ({ id: plan.id, name: plan.name, durationDays: plan.durationDays, pricePaise: plan.pricePaise, joiningFeePaise: plan.joiningFeePaise, gstPercent: plan.gstPercent, gstInclusive: plan.gstInclusive, maxFreezeDays: plan.maxFreezeDays }))}
              dues={profile.dues.map((due) => ({ id: due.id, amountPaise: due.amountPaise, dueDate: due.dueDate.toISOString() }))}
              isFirstPlan={profile.memberships.length === 0}
              canCollect={hasPermission(perms, 'payments.collect')}
              canFreeze={hasPermission(perms, 'freeze.approve')}
              canWaive={hasPermission(perms, 'dues.manage')}
              current={current ? { id: current.id, endsAt: current.endsAt.toISOString(), freezeLeft: Math.max(0, (current.plan?.maxFreezeDays ?? 0) - current.freezeDaysUsed) } : null}
              openSell={openSell}
            />
          ) : null}

          {hasPermission(perms, 'members.write') ? (
            <div>
              <p className="kicker" style={{ margin: '6px 0 8px' }}>
                DETAILS
              </p>
              <MemberForm
                mode="edit"
                memberId={athlete.id}
                base={base}
                options={options}
                defaults={{
                  name: athlete.name,
                  phone: athlete.phone.replace(/^\+91/, ''),
                  email: athlete.email ?? '',
                  gender: (athlete.gender as 'M' | 'F' | 'O' | null) ?? '',
                  dateOfBirth: athlete.dateOfBirth ? athlete.dateOfBirth.toISOString().slice(0, 10) : '',
                  homeBranchId: athlete.homeBranchId,
                  trainerId: athlete.trainerId ?? '',
                  language: athlete.language,
                  emergencyContact: athlete.emergencyContact ?? '',
                  medicalNotes: athlete.medicalNotes ?? '',
                  notes: athlete.notes,
                  biometricId: athlete.biometricId ?? '',
                }}
              />
            </div>
          ) : null}

          {profile.records.length || profile.progress.length ? (
            <section className="panel">
              <p className="kicker">PROGRESS {profile.progressHidden ? '(HIDDEN BY MEMBER)' : ''}</p>
              <h2>Records</h2>
              <div className="list-rows">
                {profile.progress.length ? (
                  <div className="list-row">
                    <span>Weight</span>
                    <strong>
                      {profile.progress[0].weightKg ?? '-'} kg to {profile.progress.at(-1)?.weightKg ?? '-'} kg
                    </strong>
                  </div>
                ) : null}
                {profile.records.map((record) => (
                  <div className="list-row" key={record.id}>
                    <span>{record.exercise}</span>
                    <strong>
                      {record.weightKg} kg x {record.reps}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <p className="muted" style={{ marginTop: 18 }}>
        <Link href={`${base}/members`}>Back to all {ctx.gym.athleteLabelPlural.toLowerCase()}</Link> - <Link href={quickAddHref(base)}>Add another</Link>
      </p>
    </StaffShell>
  )
}
