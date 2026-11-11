import { istParts } from '@/lib/time'

// Rules that apply to every gym -> member/owner message.

// No messages between 9 PM and 8 AM IST (critical ones like OTP excepted).
export const QUIET_START_HOUR = 21
export const QUIET_END_HOUR = 8

export function isQuietHour(now: Date = new Date()): boolean {
  const { hour } = istParts(now)
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

// "2026-11" in IST - the WhatsApp quota resets on the 1st of each IST month.
export function monthKey(now: Date = new Date()): string {
  const { year, month } = istParts(now)
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// Gyms whose Rep+ access is paused do not send automatic messages.
const MESSAGING_STATUSES = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE'])

export function gymCanMessage(status: string | null | undefined): boolean {
  return Boolean(status && MESSAGING_STATUSES.has(status))
}

// Share of the quota a priority may use: low-priority messages stop at 90%
// so dues reminders always have room left.
export function quotaCeiling(quota: number, priority: 'critical' | 'normal' | 'low'): number {
  if (priority === 'critical') return Number.POSITIVE_INFINITY
  if (priority === 'low') return Math.floor(quota * 0.9)
  return quota
}

export function usagePercent(sent: number, quota: number): number {
  if (quota <= 0) return sent > 0 ? 100 : 0
  return Math.min(100, Math.round((sent / quota) * 100))
}
