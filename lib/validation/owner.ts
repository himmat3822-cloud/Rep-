import { z } from 'zod'
import { phoneSchema, slugSchema, otpCodeSchema } from './auth'

// Zod schemas for owner / front desk forms and gym API routes.

const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value)
const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional())
const rupees = z.coerce.number().min(0, 'Cannot be negative').max(10_000_000)
const optionalRupees = z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(10_000_000).optional())
const id = z.string().min(1).max(40)

export const languageSchema = z.enum(['EN', 'HI', 'PA'])
export const paymentMethodSchema = z.enum(['CASH', 'UPI', 'CARD', 'BANK'])

// ---- Members ----

export const memberSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(80),
  phone: phoneSchema,
  email: z.union([z.email('Enter a valid email').trim().toLowerCase(), z.literal('')]).default(''),
  gender: z.enum(['M', 'F', 'O', '']).default(''),
  dateOfBirth: optionalDate,
  homeBranchId: id,
  trainerId: z.preprocess(emptyToUndefined, id.optional()),
  language: languageSchema.default('EN'),
  emergencyContact: z.string().trim().max(120).default(''),
  medicalNotes: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(1000).default(''),
  referralCode: z.string().trim().max(20).default(''),
  biometricId: z.string().trim().max(20).regex(/^[A-Za-z0-9]*$/, 'Letters and numbers only').default(''),
})

export const memberListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['NEW', 'REGULAR', 'SLIPPING', 'INACTIVE', 'EXPIRED', 'FROZEN']).optional(),
  branchId: z.string().max(40).optional(),
  trainerId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const archiveSchema = z.object({ archived: z.boolean() })

// ---- Money ----

export const sellSchema = z.object({
  planId: id,
  startsOn: optionalDate,
  discountRupees: rupees.default(0),
  amountPaidRupees: rupees,
  method: paymentMethodSchema,
  includeJoiningFee: z.boolean().default(false),
  note: z.string().trim().max(200).default(''),
})

export const collectSchema = z.object({
  amountRupees: optionalRupees,
  method: paymentMethodSchema,
  note: z.string().trim().max(200).default(''),
})

export const waiveSchema = z.object({ reason: z.string().trim().min(5, 'Write a short reason').max(300) })

export const freezeSchema = z.object({
  membershipId: id,
  fromDate: z.coerce.date(),
  days: z.coerce.number().int().min(1).max(180),
  reason: z.string().trim().min(3, 'Add a reason').max(200),
})

// ---- Membership plans the gym sells ----

export const membershipPlanSchema = z.object({
  name: z.string().trim().min(2).max(40),
  durationDays: z.coerce.number().int().min(1).max(1095),
  priceRupees: rupees,
  joiningFeeRupees: rupees.default(0),
  gstPercent: z.coerce.number().refine((value) => [0, 5, 12, 18].includes(value), 'GST must be 0, 5, 12 or 18%'),
  gstInclusive: z.boolean().default(true),
  maxFreezeDays: z.coerce.number().int().min(0).max(180).default(0),
  crossBranch: z.boolean().default(false),
  ptAddonRupees: optionalRupees,
  ptSessionsIncluded: z.coerce.number().int().min(0).max(200).default(0),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
})

// ---- Settings ----

export const gymProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(240).default(''),
  gstNumber: z.union([z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN is 15 characters'), z.literal('')]).default(''),
  phone: z.union([phoneSchema, z.literal('')]).default(''),
  email: z.union([z.email().trim().toLowerCase(), z.literal('')]).default(''),
})

export const gymAppSettingsSchema = z.object({
  athleteLabel: z.string().trim().min(2).max(20).regex(/^[A-Za-z ]+$/, 'Letters only'),
  athleteLabelPlural: z.string().trim().min(2).max(24).regex(/^[A-Za-z ]+$/, 'Letters only'),
  defaultLanguage: languageSchema,
  ownerHandlesDesk: z.boolean(),
  sessionMinutes: z.coerce.number().int().min(30).max(240),
  regularVisitsPerWeek: z.coerce.number().int().min(1).max(7),
  slippingAfterDays: z.coerce.number().int().min(2).max(30),
  inactiveAfterDays: z.coerce.number().int().min(5).max(90),
  leaderboard: z.boolean(),
  challenges: z.boolean(),
  progressPhotos: z.boolean(),
  renewEarlyDiscountPct: z.coerce.number().int().min(0).max(50),
  referralRewardDays: z.coerce.number().int().min(0).max(60),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}$/, '1 to 4 letters'),
  memberUpiId: z.union([z.string().trim().regex(/^[\w.-]{2,}@[a-zA-Z]{2,}$/, 'Looks like name@bank'), z.literal('')]).default(''),
  invoiceFooter: z.string().trim().max(300).default(''),
}).refine((value) => value.inactiveAfterDays > value.slippingAfterDays, { message: 'Inactive must be more days than slipping', path: ['inactiveAfterDays'] })

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const dayHours = z.union([z.tuple([hhmm, hhmm]), z.null()])

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(60),
  address: z.string().trim().max(240).default(''),
  latitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-90).max(90).optional()),
  longitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-180).max(180).optional()),
  geofenceMeters: z.coerce.number().int().min(30).max(2000).default(150),
  hourlyCapacity: z.coerce.number().int().min(1).max(1000),
  slotMinutes: z.coerce.number().refine((value) => [30, 45, 60, 90, 120].includes(value), 'Pick 30, 45, 60, 90 or 120'),
  openingHours: z.object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours }),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).default([]),
  archived: z.boolean().default(false),
})

export const staffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  email: z.union([z.email().trim().toLowerCase(), z.literal('')]).default(''),
  kind: z.enum(['TRAINER', 'DESK']),
  branchId: z.preprocess(emptyToUndefined, id.optional()),
  grants: z.array(z.string().max(40)).max(40).default([]),
  denies: z.array(z.string().max(40)).max(40).default([]),
  commissionPct: z.coerce.number().int().min(0).max(100).default(0),
  // Price of one PT session in rupees (commission = fee x commission %).
  ptSessionFeeRupees: z.coerce.number().min(0).max(100000).default(0),
  active: z.boolean().default(true),
})

// ---- Rep+ billing (no gateway: manual UPI / bank transfer) ----

export const billingClaimSchema = z.object({
  amountRupees: z.coerce.number().min(1).max(10_000_000),
  method: z.enum(['UPI', 'BANK']),
  reference: z.string().trim().min(6, 'Enter the UTR / transaction id').max(40),
  note: z.string().trim().max(300).default(''),
})

export const planChangeSchema = z.object({ planId: id, cycle: z.enum(['MONTHLY', 'ANNUAL']) })

export const claimDecisionSchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(300) })

// ---- Owner signup ----

export const signupOtpSchema = z.object({ phone: phoneSchema })

export const signupVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema })

export const signupSchema = z.object({
  ticket: z.string().min(20).max(2000),
  ownerName: z.string().trim().min(2, 'Enter your name').max(80),
  ownerEmail: z.union([z.email('Enter a valid email').trim().toLowerCase(), z.literal('')]).default(''),
  ownerPassword: z.union([z.string().min(8, 'At least 8 characters').max(128), z.literal('')]).default(''),
  gymName: z.string().trim().min(2, 'Enter your gym name').max(80),
  slug: slugSchema,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(240).default(''),
  ownerHandlesDesk: z.boolean(),
  planId: id,
  cycle: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
})
