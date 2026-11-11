import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { BranchesEditor, NEW_BRANCH } from '@/components/owner/settings-forms'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymLimits } from '@/lib/owner/limits'

export const metadata: Metadata = { title: 'Branches - Rep+' }

type Hours = typeof NEW_BRANCH.openingHours

export default async function BranchesPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const [branches, members, limits] = await Promise.all([
    db.branch.findMany({ orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }] }),
    db.athlete.groupBy({ by: ['homeBranchId'], where: { archived: false }, _count: { _all: true } }),
    getGymLimits(db),
  ])
  const countBy = new Map(members.map((row) => [row.homeBranchId, row._count._all]))
  const canAdd = limits.branches.paidExtra || limits.branches.used < limits.branches.limit
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings/branches" />
      <div style={{ maxWidth: 900 }}>
        <BranchesEditor
          canAdd={canAdd}
          limitText={`${limits.branches.used} OF ${limits.branches.limit} BRANCHES${limits.branches.paidExtra ? ' - EXTRA BRANCHES ARE BILLED' : ''}`}
          branches={branches.map((branch) => ({
            id: branch.id,
            isPrimary: branch.isPrimary,
            members: countBy.get(branch.id) ?? 0,
            name: branch.name,
            address: branch.address,
            latitude: branch.latitude ?? '',
            longitude: branch.longitude ?? '',
            geofenceMeters: branch.geofenceMeters,
            hourlyCapacity: branch.hourlyCapacity,
            slotMinutes: branch.slotMinutes,
            openingHours: { ...NEW_BRANCH.openingHours, ...(branch.openingHours as Partial<Hours>) },
            holidays: branch.holidays.map((day) => day.toISOString().slice(0, 10)),
            archived: branch.archived,
          }))}
        />
      </div>
    </StaffShell>
  )
}
