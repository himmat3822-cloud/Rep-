'use client'

import type { ApiErrorBody, ApiErrorCode } from './types'

// Tiny client-side fetch helper (no TanStack Query).
// - JSON in, JSON out
// - on TOKEN_EXPIRED it refreshes the session once and retries
// - throws ApiClientError with the server's { code, message }

export class ApiClientError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type SessionKind = 'staff' | 'athlete' | 'admin'

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  session?: SessionKind
}

let refreshing: Promise<boolean> | null = null

async function refresh(kind: SessionKind): Promise<boolean> {
  if (!refreshing) {
    const url = kind === 'admin' ? '/api/admin/auth/refresh' : `/api/auth/refresh?as=${kind}`
    refreshing = fetch(url, { method: 'POST', credentials: 'same-origin' })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!response.ok) {
    const body = data as ApiErrorBody | null
    throw new ApiClientError(response.status, body?.error?.code ?? 'INTERNAL_ERROR', body?.error?.message ?? 'Something went wrong', body?.error?.details)
  }
  return data as T
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, session = 'staff', headers, ...rest } = options
  const init: RequestInit = {
    ...rest,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  try {
    return await parse<T>(await fetch(path, init))
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'TOKEN_EXPIRED' && (await refresh(session))) {
      return parse<T>(await fetch(path, init))
    }
    throw error
  }
}
