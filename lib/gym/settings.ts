import { z } from 'zod'

// Shape of Gym.settings (JSON column). Always read through parseGymSettings
// so missing keys get defaults and old rows keep working.

export const gymSettingsSchema = z.object({
  thresholds: z
    .object({
      regularVisitsPerWeek: z.number().int().min(1).max(7).default(3),
      slippingAfterDays: z.number().int().min(2).max(30).default(5),
      inactiveAfterDays: z.number().int().min(5).max(90).default(15),
    })
    .default({ regularVisitsPerWeek: 3, slippingAfterDays: 5, inactiveAfterDays: 15 }),
  features: z
    .object({
      leaderboard: z.boolean().default(true),
      challenges: z.boolean().default(true),
      progressPhotos: z.boolean().default(true),
    })
    .default({ leaderboard: true, challenges: true, progressPhotos: true }),
  attendance: z
    .object({
      // Which check-in methods this gym uses. Owners pick what they have.
      deskQr: z.boolean().default(true),
      selfCheckin: z.boolean().default(false),
      biometric: z.boolean().default(false),
      manual: z.boolean().default(true),
      // Self check-in rules (at least one of these must stay on).
      selfRequireEntranceQr: z.boolean().default(true),
      selfRequireLocation: z.boolean().default(true),
      // Desk can still check in someone whose plan has lapsed (logged as a warning).
      manualAllowWithoutPlan: z.boolean().default(true),
    })
    .default({ deskQr: true, selfCheckin: false, biometric: false, manual: true, selfRequireEntranceQr: true, selfRequireLocation: true, manualAllowWithoutPlan: true }),
  messaging: z
    .object({
      // Dues reminders follow the stages in Settings > Reminders.
      duesAuto: z.boolean().default(true),
      tone: z.enum(['friendly', 'firm']).default('friendly'),
      // Hour of the day (IST) when daily reminders go out.
      sendHour: z.number().int().min(8).max(20).default(10),
      renewalReminders: z.boolean().default(true),
      renewalDays: z.array(z.number().int().min(1).max(30)).max(3).default([7, 1]),
      slotReminders: z.boolean().default(true),
      birthdayWishes: z.boolean().default(true),
      anniversaryWishes: z.boolean().default(true),
      weeklyReport: z.boolean().default(true),
      dailyMotivation: z.boolean().default(true),
    })
    .default({ duesAuto: true, tone: 'friendly', sendHour: 10, renewalReminders: true, renewalDays: [7, 1], slotReminders: true, birthdayWishes: true, anniversaryWishes: true, weeklyReport: true, dailyMotivation: true }),
  renewEarlyDiscountPct: z.number().int().min(0).max(50).default(0),
  referralRewardDays: z.number().int().min(0).max(60).default(7),
  invoicePrefix: z.string().regex(/^[A-Z]{1,4}$/).optional(),
  memberUpiId: z.string().max(80).optional(),
  invoiceFooter: z.string().max(300).optional(),
})

export type GymSettings = z.output<typeof gymSettingsSchema>

export function parseGymSettings(raw: unknown): GymSettings {
  const result = gymSettingsSchema.safeParse(raw ?? {})
  return result.success ? result.data : gymSettingsSchema.parse({})
}

export type AttendanceSettings = GymSettings['attendance']
export type MessagingSettings = GymSettings['messaging']
