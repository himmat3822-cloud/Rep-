import { z } from 'zod'

// Inputs from the athlete app (all small, all validated server-side).

const exerciseSchema = z.object({
  name: z.string().trim().min(1, 'Name the exercise').max(60),
  sets: z.coerce.number().int().min(1).max(20),
  reps: z.string().trim().min(1).max(20),
})

export const splitDaySchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  title: z.string().trim().min(1, 'Give the day a name').max(40),
  focus: z.string().trim().max(60).default(''),
  minutes: z.coerce.number().int().min(5).max(240).default(45),
  exercises: z.array(exerciseSchema).max(15),
})

export const splitSchema = z.object({
  days: z
    .array(splitDaySchema)
    .max(7)
    .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, 'Each weekday can appear only once'),
})
export type SplitInput = z.input<typeof splitSchema>
export type SplitOutput = z.output<typeof splitSchema>

export const slotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().max(40).optional(),
})

export const bookSchema = z.object({
  slotId: z.string().min(10).max(40),
  replaceBookingId: z.string().min(10).max(40).optional(),
})

const optionalMeasure = (min: number, max: number) =>
  z.preprocess((value) => (value === '' || value === null || value === undefined ? undefined : value), z.coerce.number().min(min).max(max).optional())

export const progressLogSchema = z
  .object({
    weightKg: optionalMeasure(20, 300),
    chestCm: optionalMeasure(30, 250),
    waistCm: optionalMeasure(30, 250),
    hipsCm: optionalMeasure(30, 250),
    armsCm: optionalMeasure(10, 100),
    thighsCm: optionalMeasure(20, 150),
    bodyFatPct: optionalMeasure(2, 70),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), 'Fill at least one number')
export type ProgressLogInput = z.input<typeof progressLogSchema>
export type ProgressLogOutput = z.output<typeof progressLogSchema>

export const recordSchema = z.object({
  exercise: z.string().trim().min(2, 'Name the lift').max(40),
  weightKg: z.coerce.number().min(0).max(600),
  reps: z.coerce.number().int().min(1).max(100).default(1),
  achievedOn: z.coerce.date().optional(),
})
export type RecordInput = z.input<typeof recordSchema>
export type RecordOutput = z.output<typeof recordSchema>

export const claimSchema = z
  .object({
    kind: z.enum(['DUE', 'RENEWAL']),
    dueId: z.string().min(10).max(40).optional(),
    planId: z.string().min(10).max(40).optional(),
    amountRupees: z.coerce.number().positive('Enter the amount you paid').max(500000),
    utr: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,30}$/, 'Enter the UPI reference number from your payment app'),
    note: z.string().trim().max(200).optional(),
  })
  .refine((value) => (value.kind === 'DUE' ? Boolean(value.dueId) : Boolean(value.planId)), 'Missing due or plan')
export type ClaimFormInput = z.input<typeof claimSchema>
export type ClaimFormOutput = z.output<typeof claimSchema>

export const freezeRequestSchema = z.object({
  fromDate: z.coerce.date(),
  days: z.coerce.number().int().min(1).max(90),
  reason: z.string().trim().min(3, 'Tell the gym why').max(200),
})
export type FreezeRequestInput = z.input<typeof freezeRequestSchema>
export type FreezeRequestOutput = z.output<typeof freezeRequestSchema>

export const privacySchema = z.object({
  shareProgressWithTrainer: z.boolean(),
  sharePhotosWithTrainer: z.boolean(),
  // Kept for when health sync ships; the switch is hidden for now.
  shareHealthWithTrainer: z.boolean().optional(),
  hideFromLeaderboard: z.boolean(),
})

export const pushSubscribeSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
})

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) })

export const feedbackKinds = ['FEEDBACK', 'EQUIPMENT', 'CLEANLINESS', 'STAFF', 'OTHER'] as const
export const feedbackSchema = z.object({
  kind: z.enum(feedbackKinds),
  title: z.string().trim().min(3, 'Say what it is about').max(80),
  body: z.string().trim().max(1000).default(''),
})

export const joinSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(60),
  phone: z.string().trim().min(10).max(16),
  ref: z.string().trim().min(3).max(30),
})

export const claimDecisionSchema = z.object({ reason: z.string().trim().min(3, 'Tell the member why').max(200) })
