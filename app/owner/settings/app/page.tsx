import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { AppSettingsForm } from '@/components/owner/settings-forms'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { parseGymSettings } from '@/lib/gym/settings'
import { getGymFeatures } from '@/lib/gym/features'
import { invoicePrefixFor } from '@/lib/gst'

export const metadata: Metadata = { title: 'App settings - Rep+' }

export default async function AppSettingsPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const [gym, features] = await Promise.all([tenantDb(ctx.gym.id).gym.findFirstOrThrow(), getGymFeatures(ctx.gym.id)])
  const settings = parseGymSettings(gym.settings)
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings/app" />
      <div style={{ maxWidth: 820 }}>
        <AppSettingsForm
          showMemberFeatures={{ leaderboard: features.includes('leaderboard'), challenges: features.includes('challenges'), progressPhotos: features.includes('progress_tracking') }}
          defaults={{
            athleteLabel: gym.athleteLabel,
            athleteLabelPlural: gym.athleteLabelPlural,
            defaultLanguage: gym.defaultLanguage,
            ownerHandlesDesk: gym.ownerHandlesDesk,
            sessionMinutes: gym.sessionMinutes,
            regularVisitsPerWeek: settings.thresholds.regularVisitsPerWeek,
            slippingAfterDays: settings.thresholds.slippingAfterDays,
            inactiveAfterDays: settings.thresholds.inactiveAfterDays,
            leaderboard: settings.features.leaderboard,
            challenges: settings.features.challenges,
            progressPhotos: settings.features.progressPhotos,
            renewEarlyDiscountPct: settings.renewEarlyDiscountPct,
            referralRewardDays: settings.referralRewardDays,
            invoicePrefix: settings.invoicePrefix ?? invoicePrefixFor(gym.name),
            memberUpiId: settings.memberUpiId ?? '',
            invoiceFooter: settings.invoiceFooter ?? '',
          }}
        />
      </div>
    </StaffShell>
  )
}
