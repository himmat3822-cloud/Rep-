import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { DeviceManager, EntrancePosters, MethodSettings } from '@/components/attendance/attendance-setup'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { appUrl } from '@/lib/env'

export const metadata: Metadata = { title: 'Attendance setup - Rep+' }

export default async function AttendanceSettingsPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const [config, branches, devices] = await Promise.all([
    loadGymConfig(db, ctx.gym.id),
    db.branch.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, latitude: true } }),
    db.attendanceDevice.findMany({ orderBy: { createdAt: 'asc' } }),
  ])
  const a = config.settings.attendance
  const bioInPlan = config.features.includes('biometric_integration')
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings/attendance" />
      <div className="stack" style={{ maxWidth: 940 }}>
        <MethodSettings initial={a} qrInPlan={config.features.includes('qr_attendance')} biometricInPlan={bioInPlan} />
        {a.selfCheckin ? <EntrancePosters branches={branches.map((branch) => ({ id: branch.id, name: branch.name, hasLocation: branch.latitude !== null }))} /> : null}
        {a.biometric || bioInPlan ? (
          <DeviceManager
            inPlan={bioInPlan}
            appUrl={appUrl()}
            branches={branches}
            devices={devices.map((device) => ({ id: device.id, name: device.name, kind: device.kind, vendor: device.vendor, serialNumber: device.serialNumber, keyPrefix: device.keyPrefix, branchId: device.branchId, allowedIps: device.allowedIps, active: device.active, lastSeenAt: device.lastSeenAt?.toISOString() ?? null, punches: device.punches }))}
          />
        ) : null}
        <p className="muted">
          Members get their Biometric ID on their profile (the enrolment number on your machine). Auto checkout happens after {ctx.gym.sessionMinutes} minutes; change it in App settings.
        </p>
      </div>
    </StaffShell>
  )
}
