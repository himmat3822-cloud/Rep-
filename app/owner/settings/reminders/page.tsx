import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { SettingsTabs } from '@/components/owner/settings-tabs'
import { ReminderSettingsForm } from '@/components/owner/reminder-settings'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { DEFAULT_REMINDER_STAGES } from '@/lib/platform/gyms'
import { DUE_STAGE_TEMPLATES, type DueStageTemplate } from '@/lib/messaging/templates'

export const metadata: Metadata = { title: 'Reminder settings - Rep+' }

const asTemplate = (value: string): DueStageTemplate => ((DUE_STAGE_TEMPLATES as readonly string[]).includes(value) ? (value as DueStageTemplate) : 'kasrat_due_followup')

export default async function ReminderSettingsPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const [config, stages, subscription, override] = await Promise.all([
    loadGymConfig(db, ctx.gym.id),
    db.reminderStage.findMany({ orderBy: { stage: 'asc' } }),
    db.gymSubscription.findFirst({ select: { plan: { select: { whatsappQuota: true } } } }),
    db.gymOverride.findFirst({ select: { whatsappTopUp: true } }),
  ])
  const m = config.settings.messaging
  const rows = stages.length ? stages : DEFAULT_REMINDER_STAGES.map((stage) => ({ ...stage, customText: null, enabled: true }))
  return (
    <StaffShell ctx={ctx} title="Settings">
      <SettingsTabs active="/owner/settings/reminders" />
      <div style={{ maxWidth: 1080 }}>
        <ReminderSettingsForm
          gymName={ctx.gym.name}
          features={config.features}
          quota={(subscription?.plan.whatsappQuota ?? 0) + (override?.whatsappTopUp ?? 0)}
          defaults={{
            ...m,
            stages: rows.map((stage) => ({ name: stage.name, offsetDays: stage.offsetDays, template: asTemplate(stage.template), customText: stage.customText ?? '', enabled: stage.enabled })),
          }}
        />
      </div>
    </StaffShell>
  )
}
