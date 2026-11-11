import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { StaffShell, type StaffPageContext } from '@/components/staff/staff-shell'
import { ComingSoon } from '@/components/shell/coming-soon'
import { tenantDb } from '@/lib/db/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { loadGymConfig } from '@/lib/gym/context'
import { enabledMethods } from '@/lib/attendance/methods'
import { getAttendanceInsights, getOccupancy } from '@/lib/attendance/insights'
import { addDays, istStartOfDay } from '@/lib/time'
import { CheckinDesk } from './checkin-desk'
import { BiometricImport, ManualRegister } from './register-and-import'
import { InsightsView } from './insights-view'

// One attendance screen for owner (/owner/attendance, /owner/desk/scanner)
// and front desk (/desk/scanner). Tabs depend on the methods the owner
// switched on and on the viewer's permissions.

type Tab = 'desk' | 'register' | 'import' | 'insights'

export async function AttendanceView({ ctx, basePath, tab, title }: { ctx: StaffPageContext; basePath: string; tab?: string; title: string }) {
  const db = tenantDb(ctx.gym.id)
  const config = await loadGymConfig(db, ctx.gym.id)
  const methods = enabledMethods(config.settings.attendance, config.features)
  const perms = ctx.claims.perms
  const isOwner = ctx.user.kind === 'OWNER'
  const membersBase = isOwner ? '/owner' : '/desk'
  const canInsights = isOwner && hasPermission(perms, 'reports.read') && config.features.includes('peak_hours')
  const tabs: { key: Tab; label: string }[] = []
  if (methods.deskQr || methods.manual) tabs.push({ key: 'desk', label: 'Check in' })
  if (methods.manual) tabs.push({ key: 'register', label: 'Paper register' })
  if (methods.biometric) tabs.push({ key: 'import', label: 'Biometric log' })
  if (canInsights) tabs.push({ key: 'insights', label: 'Peak hours and trends' })
  const active: Tab = (tabs.find((item) => item.key === tab)?.key ?? tabs[0]?.key ?? 'desk') as Tab

  const branches = await db.branch.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })
  const occupancy = await getOccupancy(db, ctx.gym.sessionMinutes)
  const inside = occupancy.reduce((sum, row) => sum + row.inside, 0)
  const capacity = occupancy.reduce((sum, row) => sum + row.capacity, 0)

  let body: React.ReactNode = null
  if (tabs.length === 0) {
    body = <ComingSoon title="No check-in method is on" text="Pick how your gym marks attendance in Settings > Attendance." items={['QR at the desk', 'Self check-in', 'Biometric / turnstile', 'Manual / register']} />
  } else if (active === 'desk') {
    body = <CheckinDesk branches={branches} deskQr={methods.deskQr} manual={methods.manual} label={ctx.gym.athleteLabel} base={membersBase} />
  } else if (active === 'register') {
    const since = addDays(istStartOfDay(), -14)
    const [members, recent] = await Promise.all([
      db.athlete.findMany({ where: { archived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, memberCode: true, homeBranchId: true } }),
      db.checkIn.findMany({ where: { checkedInAt: { gte: since } }, select: { athleteId: true, checkedInAt: true } }),
    ])
    const presentByDate: Record<string, string[]> = {}
    for (const row of recent) {
      const key = new Date(row.checkedInAt.getTime() + 330 * 60000).toISOString().slice(0, 10)
      ;(presentByDate[key] ??= []).push(row.athleteId)
    }
    body = <ManualRegister branches={branches} presentByDate={presentByDate} members={members.map((member) => ({ id: member.id, name: member.name, memberCode: member.memberCode, branchId: member.homeBranchId }))} />
  } else if (active === 'import') {
    const devices = await db.attendanceDevice.findMany({ where: { active: true }, select: { id: true, name: true } })
    body = <BiometricImport branches={branches} devices={devices} />
  } else if (active === 'insights') {
    body = <InsightsView data={await getAttendanceInsights(db, null)} />
  }

  return (
    <StaffShell ctx={ctx} title={title}>
      <div className="page-head">
        <div className="sum-strip" style={{ marginBottom: 0 }}>
          <div>
            Inside now<strong>{inside}</strong>
          </div>
          <div>
            Floor<strong>{capacity ? Math.round((inside / capacity) * 100) : 0}%</strong>
          </div>
          <div>
            Methods on
            <strong style={{ fontSize: 12 }}>
              {[methods.deskQr && 'Desk QR', methods.selfCheckin && 'Self', methods.biometric && 'Biometric', methods.manual && 'Manual'].filter(Boolean).join(', ') || 'none'}
            </strong>
          </div>
        </div>
        {isOwner ? (
          <Link className="btn btn-outline" href="/owner/settings/attendance">
            <Settings2 /> Attendance setup
          </Link>
        ) : null}
      </div>
      {tabs.length > 1 ? (
        <div className="tab-links">
          {tabs.map((item) => (
            <Link key={item.key} href={`${basePath}?tab=${item.key}`} className={item.key === active ? 'active' : ''}>
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      {body}
    </StaffShell>
  )
}
