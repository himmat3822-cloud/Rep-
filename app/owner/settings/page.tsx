import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { GymProfileForm } from '@/components/owner/settings-forms'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { logoUrl } from '@/lib/integrations/cloudinary'

export const metadata: Metadata = { title: 'Settings - Rep+' }

export default async function SettingsPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const gym = await tenantDb(ctx.gym.id).gym.findFirstOrThrow()
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings" />
      <div style={{ maxWidth: 820 }}>
        <GymProfileForm
          logo={logoUrl(gym.logoPublicId)}
          defaults={{ name: gym.name, city: gym.city, address: gym.address, gstNumber: gym.gstNumber ?? '', phone: gym.phone?.replace(/^\+91/, '') ?? '', email: gym.email ?? '' }}
        />
        <p className="muted" style={{ marginTop: 14 }}>
          Member app link: <strong>/g/{gym.slug}</strong>. Share it on WhatsApp so members can log in with their number.
        </p>
      </div>
    </StaffShell>
  )
}
