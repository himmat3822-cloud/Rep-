import { z } from 'zod'
import { DUE_STAGE_TEMPLATES } from '@/lib/messaging/templates'

// WhatsApp parameters cannot contain new lines or tabs.
const noteText = z
  .string()
  .trim()
  .max(160, 'Keep the note under 160 characters')
  .refine((value) => !/[\r\n\t]/.test(value), 'The note must be a single line')

export const reminderStageSchema = z.object({
  name: z.string().trim().min(2, 'Give the stage a name').max(40),
  offsetDays: z.coerce.number().int().min(-10, 'At most 10 days before').max(30, 'At most 30 days after'),
  template: z.enum(DUE_STAGE_TEMPLATES),
  customText: noteText.optional().or(z.literal('')),
  enabled: z.boolean(),
})

export const reminderSettingsSchema = z
  .object({
    duesAuto: z.boolean(),
    tone: z.enum(['friendly', 'firm']),
    sendHour: z.coerce.number().int().min(8, 'Messages cannot go out before 8 AM').max(20, 'Messages cannot go out after 8 PM'),
    renewalReminders: z.boolean(),
    renewalDays: z.array(z.coerce.number().int().min(1).max(30)).max(3, 'Pick up to 3 days'),
    slotReminders: z.boolean(),
    birthdayWishes: z.boolean(),
    anniversaryWishes: z.boolean(),
    weeklyReport: z.boolean(),
    dailyMotivation: z.boolean(),
    stages: z.array(reminderStageSchema).min(1, 'Keep at least one stage').max(6, 'Up to 6 stages'),
  })
  .superRefine((value, ctx) => {
    for (let i = 1; i < value.stages.length; i += 1) {
      if (value.stages[i].offsetDays <= value.stages[i - 1].offsetDays) {
        ctx.addIssue({ code: 'custom', path: ['stages', i, 'offsetDays'], message: 'Each stage must come after the one above it' })
      }
    }
    if (value.renewalReminders && value.renewalDays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['renewalDays'], message: 'Pick at least one day, or switch renewal reminders off' })
    }
  })

export type ReminderSettingsInput = z.input<typeof reminderSettingsSchema>
export type ReminderSettingsOutput = z.output<typeof reminderSettingsSchema>

export const messageLogQuerySchema = z.object({
  purpose: z.string().max(40).optional(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const cronForceSchema = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').map((item) => item.trim()) : []))
  .pipe(z.array(z.enum(['dues', 'renewals', 'wishes', 'weekly', 'slots'])))
