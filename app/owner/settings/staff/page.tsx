import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { StaffEditor } from '@/components/owner/settings-forms'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymLimits } from '@/lib/owner/limits'

export const metadata: Metadata = { title: 'Staff - Rep+' }

export default async function StaffPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const [staff, branches, limits] = await Promise.all([
    db.gymUser.findMany({ where: { kind: { in: ['TRAINER', 'DESK'] } }, orderBy: [{ active: 'desc' }, { kind: 'asc' }, { name: 'asc' }] }),
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true } }),
    getGymLimits(db),
  ])
  const canAdd = limits.staff.limit === null || limits.staff.used < limits.staff.limit
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings/staff" />
      <div style={{ maxWidth: 900 }}>
        <StaffEditor
          deskEnabled={ctx.gym.ownerHandlesDesk}
          canAdd={canAdd}
          limitText={`${limits.staff.used} OF ${limits.staff.limit ?? 'UNLIMITED'} STAFF ACCOUNTS`}
          branches={branches}
          staff={staff.map((member) => ({
            id: member.id,
            name: member.name,
            phone: member.phone,
            email: member.email ?? '',
            kind: member.kind as 'TRAINER' | 'DESK',
            branchId: member.branchId ?? '',
            grants: member.grants,
            denies: member.denies,
            commissionPct: member.commissionPct,
            ptSessionFeeRupees: member.ptSessionFeePaise / 100,
            active: member.active,
            lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </StaffShell>
  )
}
