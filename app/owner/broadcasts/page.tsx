import type { Metadata } from 'next'
import Link from 'next/link'
import { Moon } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { BroadcastComposer } from '@/components/messaging/broadcast-composer'
import { AutoRules, CancelCampaign, type RuleView } from '@/components/messaging/auto-rules'
import { requireStaffPage } from '@/lib/auth/page'
import { hasPermission } from '@/lib/auth/permissions'
import { tenantDb } from '@/lib/db/tenant'
import { getBranchView, viewDb } from '@/lib/owner/branch-view'
import { listRules, PRESET_LABEL, recentCampaigns } from '@/lib/messaging/broadcast'
import { PRESET_KEYS, presetLine } from '@/lib/messaging/templates'
import { isQuietHour } from '@/lib/messaging/policy'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Send messages - Rep+' }

const TABS = [
  { key: 'send', label: 'Send now' },
  { key: 'auto', label: 'Automatic' },
  { key: 'history', label: 'Sent' },
] as const

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const requested = (await searchParams).tab
  const tab = TABS.find((t) => t.key === requested)?.key ?? 'send'
  const db = tenantDb(ctx.gym.id)
  const view = await getBranchView(ctx.gym.id, true)
  const lockBranch = view.mode === 'separate' && view.branchId ? { id: view.branchId, name: view.branchName ?? 'This branch' } : null
  const [branches, trainers, allRules, campaigns] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    db.gymUser.findMany({ where: { active: true, kind: { in: ['TRAINER', 'OWNER'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, kind: true } }),
    tab === 'auto' ? listRules(db) : Promise.resolve([]),
    tab === 'history' ? recentCampaigns(db, 30) : Promise.resolve([]),
  ])
  // One-branch view: this branch's rules and the all-branches ones.
  const rules = lockBranch ? allRules.filter((rule) => !rule.audience.branchId || rule.audience.branchId === lockBranch.id) : allRules
  // Only people who actually train members appear in the trainer filter.
  const roster = await (await viewDb(ctx.gym.id, true)).athlete.groupBy({ by: ['trainerId'], where: { archived: false, trainerId: { not: null } }, _count: { _all: true } })
  const trainerList = trainers.filter((t) => roster.some((r) => r.trainerId === t.id)).map((t) => ({ id: t.id, name: t.name }))
  const presets = PRESET_KEYS.map((key) => ({ key, label: PRESET_LABEL[key], example: presetLine('EN', key, { name: 'Arjun', gym: ctx.gym.name, days: key === 'ending' ? 3 : 7 }) }))
  const when = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const canSend = hasPermission(ctx.claims.perms, 'announcements.manage')

  const ruleViews: RuleView[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    audienceLabel: rule.audienceLabel,
    segment: rule.audience.segment,
    days: rule.audience.days ?? null,
    branchId: rule.audience.branchId ?? null,
    trainerId: rule.audience.trainerId ?? null,
    preset: rule.preset,
    presetLabel: rule.preset ? PRESET_LABEL[rule.preset] : null,
    customText: rule.customText,
    channel: rule.channel,
    cooldownDays: rule.cooldownDays,
    enabled: rule.enabled,
    lastRun: rule.lastRunAt ? when(rule.lastRunAt) : null,
    sent30: rule.sent30,
  }))

  return (
    <StaffShell ctx={ctx} title="Send messages">
      <div className="tab-links" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/owner/broadcasts?tab=${t.key}`} className={t.key === tab ? 'active' : ''}>
            {t.label}
          </Link>
        ))}
      </div>
      {isQuietHour() ? (
        <p className="tip">
          <Moon /> It is quiet hours (9 PM to 8 AM). Messages you send now wait and go out at 8 AM.
        </p>
      ) : null}
      {!canSend ? <p className="muted">You need permission to send member messages.</p> : null}

      {canSend && tab === 'send' ? (
        <section className="panel">
          <p className="bc-intro">Pick who gets it and what it says. Each member gets it in their own language, as a free app notification first, and on WhatsApp only if needed.</p>
          <BroadcastComposer mode="send" branches={branches} trainers={trainerList} presets={presets} lockBranch={lockBranch} />
        </section>
      ) : null}

      {canSend && tab === 'auto' ? (
        <>
          <p className="bc-intro">Automatic messages run every morning on their own. Each member gets a rule&apos;s message once, then not again until the gap you choose has passed.</p>
          <AutoRules rules={ruleViews} branches={branches} trainers={trainerList} presets={presets} lockBranch={lockBranch} />
        </>
      ) : null}

      {canSend && tab === 'history' ? (
        campaigns.length === 0 ? (
          <section className="panel empty-panel">
            <h2>Nothing sent yet</h2>
            <p>Messages you send from &quot;Send now&quot; show up here with how many went out.</p>
          </section>
        ) : (
          <div className="table-wrap panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Message</th>
                  <th className="num">Members</th>
                  <th className="num">Sent</th>
                  <th className="num">Skipped</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.title}
                      <span className="sub">
                        {when(c.createdAt)}
                        {c.cancelled ? ' - stopped' : c.counts.waiting ? ` - ${c.counts.waiting} waiting` : ''}
                      </span>
                    </td>
                    <td className="num">{c.total}</td>
                    <td className="num">{c.counts.sent}</td>
                    <td className="num" title="Already got it today, no app (app-only), replied STOP, or monthly WhatsApp limit">
                      {c.counts.skipped + c.counts.failed}
                    </td>
                    <td>{c.counts.waiting > 0 && !c.cancelled ? <CancelCampaign id={c.id} waiting={c.counts.waiting} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </StaffShell>
  )
}
