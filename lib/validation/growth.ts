import { z } from 'zod'
import { phoneSchema } from './auth'

// Leads CRM, at-risk contacts, announcements, challenges, complaints,
// expenses and reports.

const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value)
const optionalDateTime = z.preprocess(emptyToUndefined, z.coerce.date().optional())
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).max(40).optional())

export const LEAD_SOURCES = ['WALK_IN', 'INSTAGRAM', 'GOOGLE', 'REFERRAL', 'WEBSITE', 'OTHER'] as const
export const LEAD_STAGES = ['NEW', 'TRIAL', 'FOLLOW_UP', 'JOINED', 'LOST'] as const

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(80),
  phone: phoneSchema,
  source: z.enum(LEAD_SOURCES),
  interest: z.string().trim().max(120).default(''),
  nextFollowUpAt: optionalDateTime,
  assignedToId: optionalId,
  branchId: optionalId,
  notes: z.string().trim().max(2000).default(''),
})
export type LeadInput = z.input<typeof leadSchema>
export type LeadOutput = z.output<typeof leadSchema>

export const leadUpdateSchema = z
  .object({
    stage: z.enum(LEAD_STAGES).optional(),
    nextFollowUpAt: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()),
    assignedToId: z.preprocess((v) => (v === '' ? null : v), z.string().min(1).max(40).nullable().optional()),
    interest: z.string().trim().max(120).optional(),
    lostReason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.stage !== 'LOST' || (value.lostReason ?? '').length >= 2, { message: 'Say why the lead was lost', path: ['lostReason'] })

export const leadContactSchema = z.object({
  note: z.string().trim().min(2, 'Write what happened').max(500),
  nextFollowUpAt: optionalDateTime,
  stage: z.enum(['NEW', 'TRIAL', 'FOLLOW_UP']).optional(),
})

export const leadConvertSchema = z.object({ homeBranchId: z.string().min(1).max(40) })

export const enquirySchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  phone: z.string().trim().min(10).max(16),
  interest: z.string().trim().max(120).default(''),
  message: z.string().trim().max(500).default(''),
  // Honeypot: real people leave it empty. Not rejected here, so a bot gets
  // the normal success reply and learns nothing; the route drops it.
  website: z.string().max(500).optional().default(''),
})

export const riskContactSchema = z.object({
  outcome: z.enum(['REACHED_COMING_BACK', 'REACHED_NOT_INTERESTED', 'NO_ANSWER', 'RENEWED']),
  note: z.string().trim().max(300).default(''),
})

export const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Add a title').max(80),
  body: z.string().trim().min(3, 'Write the announcement').max(1000),
  pinned: z.boolean().default(false),
  expiresAt: optionalDateTime,
  branchId: optionalId,
  push: z.boolean().default(true),
})
export type AnnouncementInput = z.input<typeof announcementSchema>
export type AnnouncementOutput = z.output<typeof announcementSchema>

export const challengeSchema = z
  .object({
    title: z.string().trim().min(3, 'Name the challenge').max(60),
    description: z.string().trim().max(300).default(''),
    metric: z.enum(['visits', 'streak']),
    target: z.coerce.number().int().min(1).max(366),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    badge: z.boolean().default(true),
  })
  .refine((value) => value.endsAt >= value.startsAt, { message: 'The end must be after the start', path: ['endsAt'] })
  .refine((value) => (value.endsAt.getTime() - value.startsAt.getTime()) / 86400000 <= 92, { message: 'Keep challenges to 3 months or less', path: ['endsAt'] })
export type ChallengeInput = z.input<typeof challengeSchema>
export type ChallengeOutput = z.output<typeof challengeSchema>

export const complaintUpdateSchema = z
  .object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']), resolutionNote: z.string().trim().max(500).default('') })
  .refine((value) => value.status !== 'RESOLVED' || value.resolutionNote.length >= 3, { message: 'Tell the member what was done', path: ['resolutionNote'] })

export const EXPENSE_CATEGORIES = ['RENT', 'SALARY', 'ELECTRICITY', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER'] as const
export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountRupees: z.coerce.number().positive('Enter the amount').max(10_000_000),
  spentOn: z.coerce.date(),
  note: z.string().trim().max(200).default(''),
  branchId: optionalId,
})
export type ExpenseInput = z.input<typeof expenseSchema>
export type ExpenseOutput = z.output<typeof expenseSchema>

export const REPORT_KINDS = ['revenue', 'members', 'attendance', 'dues', 'leads', 'pt', 'expenses'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const reportQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) })
