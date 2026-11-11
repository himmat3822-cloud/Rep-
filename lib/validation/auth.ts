import { z } from 'zod'
import { toE164 } from '@/lib/phone'

// Shared Zod schemas for auth. Used by route handlers AND the login forms.

export const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Enter your mobile number')
  .transform((value, ctx) => {
    const e164 = toE164(value)
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' })
      return z.NEVER
    }
    return e164
  })

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Invalid gym link')

export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code')

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  scope: z.enum(['staff', 'athlete']),
  gymSlug: slugSchema.optional(),
})

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  scope: z.enum(['staff', 'athlete']),
  gymSlug: slugSchema.optional(),
})

export const passwordLoginSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  gymSlug: slugSchema.optional(),
})

export const adminLoginSchema = z.object({
  adminId: z.string().trim().min(3, 'Enter your admin ID').max(64),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  totp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit authenticator code'),
})

export const refreshQuerySchema = z.object({
  as: z.enum(['staff', 'athlete']).default('staff'),
  next: z.string().optional(),
})

export type OtpRequestInput = z.input<typeof otpRequestSchema>
export type OtpVerifyInput = z.input<typeof otpVerifySchema>
export type PasswordLoginInput = z.input<typeof passwordLoginSchema>
export type AdminLoginInput = z.input<typeof adminLoginSchema>

// Only allow same-site relative redirects after login/refresh.
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
