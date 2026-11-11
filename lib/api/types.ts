// Shared API types used by route handlers and the frontend.
// Keep this file free of server-only imports.

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'FEATURE_NOT_IN_PLAN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INVALID_OTP'
  | 'OTP_LOCKED'
  | 'INVALID_CREDENTIALS'
  | 'GYM_SELECTION_REQUIRED'
  | 'GYM_READ_ONLY'
  | 'GYM_PAUSED'
  | 'GYM_SUSPENDED'
  | 'ACCOUNT_DISABLED'
  | 'DELIVERY_FAILED'
  | 'IMPERSONATION_READ_ONLY'
  | 'CHECKIN_BLOCKED'
  | 'METHOD_DISABLED'
  | 'INTERNAL_ERROR'

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
}

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED'
export type StaffKind = 'OWNER' | 'TRAINER' | 'DESK'
export type LanguageCode = 'EN' | 'HI' | 'PA'

// ---- Auth ----

export interface OtpRequestBody {
  phone: string
  scope: 'staff' | 'athlete'
  gymSlug?: string
}

export interface OtpRequestResponse {
  sent: true
  maskedPhone: string
  expiresInSeconds: number
}

export interface OtpVerifyBody {
  phone: string
  code: string
  scope: 'staff' | 'athlete'
  gymSlug?: string
}

export interface GymChoice {
  slug: string
  name: string
  city: string
}

export interface StaffSessionUser {
  type: 'staff'
  id: string
  name: string
  kind: StaffKind
  gymId: string
  gymSlug: string
  permissions: string[]
  ownerHandlesDesk: boolean
}

export interface AthleteSessionUser {
  type: 'athlete'
  id: string
  name: string
  gymId: string
  gymSlug: string
  language: LanguageCode
}

export interface AdminSessionUser {
  type: 'admin'
  id: string
  adminId: string
  name: string
}

export type SessionUser = StaffSessionUser | AthleteSessionUser | AdminSessionUser

export interface LoginResponse {
  user: SessionUser
  redirectTo: string
}

export interface MeResponse {
  user: StaffSessionUser | AthleteSessionUser
  gym: {
    id: string
    slug: string
    name: string
    city: string
    subscriptionStatus: SubscriptionStatus
    athleteLabel: string
    athleteLabelPlural: string
  }
}
