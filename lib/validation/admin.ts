import { z } from 'zod'
import { FEATURES, isComingSoon } from '@/lib/features'
import { phoneSchema, slugSchema } from './auth'

// Zod schemas for every super-admin form and route.

// Coming-soon features can't be put in a plan or granted to a gym.
const featureKeys = FEATURES.map((feature) => feature.key).filter((key) => !isComingSoon(key)) as [string, ...string[]]
const rupees = z.coerce.number().min(0, 'Cannot be negative').max(10_000_000)
const optionalInt = z.preprocess((value) => (value === '' || value === null || value === undefined ? null : value), z.coerce.number().int().min(0).nullable())

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,30}$/, 'Use 2-30 lowercase letters, numbers, - or _'),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(240).default(''),
  monthlyPriceRupees: rupees,
  annualPriceRupees: rupees,
  memberLimit: optionalInt,
  branchLimit: z.coerce.number().int().min(1).max(100),
  extraBranchRupees: z.preprocess((value) => (value === '' || value === null || value === undefined ? null : value), z.coerce.number().min(0).nullable()),
  staffLimit: optionalInt,
  trainerLimit: optionalInt,
  deskLimit: optionalInt,
  whatsappQuota: z.coerce.number().int().min(0).max(1_000_000),
  features: z.array(z.enum(featureKeys)).default([]),
  isPopular: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
})

export const planUpdateSchema = planSchema.omit({ code: true }).extend({ archived: z.boolean().optional() })

export const createGymSchema = z.object({
  name: z.string().trim().min(2, 'Gym name is required').max(80),
  slug: slugSchema,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(240).default(''),
  ownerName: z.string().trim().min(2).max(80),
  ownerPhone: phoneSchema,
  ownerEmail: z.union([z.email().trim().toLowerCase(), z.literal('')]).default(''),
  ownerPassword: z.union([z.string().min(8, 'At least 8 characters').max(128), z.literal('')]).default(''),
  planId: z.string().min(1, 'Pick a plan'),
  cycle: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
  trialDays: z.coerce.number().int().min(0).max(90).default(14),
  ownerHandlesDesk: z.boolean().default(true),
})

export const updateGymSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(240),
  gstNumber: z.union([z.string().trim().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN is 15 characters'), z.literal('')]),
  planId: z.string().min(1),
  cycle: z.enum(['MONTHLY', 'ANNUAL']),
  ownerHandlesDesk: z.boolean(),
})

export const overrideSchema = z.object({
  customPriceRupees: z.preprocess((value) => (value === '' || value === null || value === undefined ? null : value), z.coerce.number().min(0).nullable()),
  extraMembers: z.coerce.number().int().min(0).max(100_000),
  extraBranches: z.coerce.number().int().min(0).max(50),
  extraStaff: z.coerce.number().int().min(0).max(500),
  extraFeatures: z.array(z.enum(featureKeys)).default([]),
  removedFeatures: z.array(z.enum(featureKeys)).default([]),
  whatsappTopUp: z.coerce.number().int().min(0).max(1_000_000),
  note: z.string().trim().max(500).default(''),
})

export const reasonSchema = z.string().trim().min(5, 'Write a short reason (5+ characters)').max(500)

export const gymStatusSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('suspend'), reason: reasonSchema }),
  z.object({ action: z.literal('restore'), reason: reasonSchema }),
  z.object({ action: z.literal('cancel'), reason: reasonSchema }),
  z.object({ action: z.literal('extend_trial'), reason: reasonSchema, days: z.coerce.number().int().min(1).max(90) }),
  z.object({ action: z.literal('free_months'), reason: reasonSchema, months: z.coerce.number().int().min(1).max(12) }),
])

export const impersonateSchema = z.object({
  mode: z.enum(['read', 'write']).default('read'),
  reason: reasonSchema,
})

export const markPaidSchema = z.object({
  amountRupees: z.coerce.number().min(1).max(10_000_000),
  reference: z.string().trim().min(3, 'Add a reference (UTR, cheque no.)').max(80),
})

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(2000),
  audience: z.enum(['ALL', 'TRIAL', 'ACTIVE', 'PAST_DUE']).default('ALL'),
  sendEmail: z.boolean().default(false),
  sendWhatsapp: z.boolean().default(false),
})

export const gymListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const auditQuerySchema = z.object({
  gymId: z.string().optional(),
  action: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export type PlanInput = z.input<typeof planSchema>
export type CreateGymInput = z.input<typeof createGymSchema>
export type OverrideInput = z.input<typeof overrideSchema>
