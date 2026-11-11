// Attendance status engine (pure functions, shared by the nightly cron,
// check-in handler and the seed script).

export type AttendanceStatusValue = 'NEW' | 'REGULAR' | 'SLIPPING' | 'INACTIVE' | 'EXPIRED' | 'FROZEN'

export interface StatusThresholds {
  regularVisitsPerWeek: number
  slippingAfterDays: number
  inactiveAfterDays: number
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  regularVisitsPerWeek: 3,
  slippingAfterDays: 5,
  inactiveAfterDays: 15,
}

export interface StatusInput {
  now: Date
  joinedAt: Date
  lastVisitAt: Date | null
  visitsLast14Days: number
  hasActiveMembership: boolean
  isFrozen: boolean
}

const DAY_MS = 24 * 3600 * 1000

export function computeAttendanceStatus(input: StatusInput, thresholds: StatusThresholds = DEFAULT_THRESHOLDS): AttendanceStatusValue {
  if (input.isFrozen) return 'FROZEN'
  if (!input.hasActiveMembership) return 'EXPIRED'
  const daysSinceJoin = Math.floor((input.now.getTime() - input.joinedAt.getTime()) / DAY_MS)
  if (!input.lastVisitAt) return daysSinceJoin < thresholds.slippingAfterDays ? 'NEW' : daysSinceJoin >= thresholds.inactiveAfterDays ? 'INACTIVE' : 'SLIPPING'
  const daysSinceVisit = Math.floor((input.now.getTime() - input.lastVisitAt.getTime()) / DAY_MS)
  if (daysSinceVisit >= thresholds.inactiveAfterDays) return 'INACTIVE'
  if (daysSinceVisit >= thresholds.slippingAfterDays) return 'SLIPPING'
  if (daysSinceJoin < 14 && input.visitsLast14Days < thresholds.regularVisitsPerWeek * 2) return 'NEW'
  return 'REGULAR'
}

// Streak = consecutive gym-open days with a visit, counting back from today
// (or yesterday if they have not come in yet today). Holidays and the
// athlete's planned rest days are skipped, never break the streak.
export function computeStreak(visitDayKeys: ReadonlySet<string>, today: Date, restWeekdays: readonly number[], holidayKeys: ReadonlySet<string>, dayKey: (date: Date) => string, weekdayOf: (date: Date) => number): number {
  let streak = 0
  let cursor = new Date(today)
  if (!visitDayKeys.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY_MS)
  for (let guard = 0; guard < 400; guard += 1) {
    const key = dayKey(cursor)
    const skippable = restWeekdays.includes(weekdayOf(cursor)) || holidayKeys.has(key)
    if (visitDayKeys.has(key)) streak += 1
    else if (!skippable) break
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return streak
}
