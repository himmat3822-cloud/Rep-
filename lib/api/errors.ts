import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { TenantViolationError } from '@/lib/db/tenant-core'
import type { ApiErrorBody, ApiErrorCode } from './types'

// Every API error leaves the server as { error: { code, message } }.

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown
  readonly headers?: Record<string, string>

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

export const errors = {
  unauthenticated: (message = 'Please log in to continue') => new ApiError(401, 'UNAUTHENTICATED', message),
  tokenExpired: () => new ApiError(401, 'TOKEN_EXPIRED', 'Session expired, refreshing'),
  forbidden: (message = 'You do not have permission to do this') => new ApiError(403, 'FORBIDDEN', message),
  featureLocked: (feature: string) => new ApiError(403, 'FEATURE_NOT_IN_PLAN', `This feature (${feature}) is not part of your gym's Rep+ plan`),
  notFound: (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: unknown) => new ApiError(409, 'CONFLICT', message, details),
  validation: (message: string, details?: unknown) => new ApiError(422, 'VALIDATION_ERROR', message, details),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) }),
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } }
    if (error.details !== undefined) body.error.details = error.details
    return NextResponse.json(body, { status: error.status, headers: error.headers })
  }
  if (error instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Invalid input',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    }
    return NextResponse.json(body, { status: 422 })
  }
  if (error instanceof TenantViolationError) {
    console.error('[tenant-violation]', error.message)
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } } satisfies ApiErrorBody, { status: 403 })
  }
  console.error('[api] unhandled error', error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } } satisfies ApiErrorBody, { status: 500 })
}
