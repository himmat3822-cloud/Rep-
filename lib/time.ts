// India Standard Time helpers. IST is UTC+5:30 with no daylight saving,
// so a fixed offset is exact. All business days (attendance, dues, reminder
// quiet hours) are computed in IST.

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 24 * 3600 * 1000

// Wall-clock parts of an instant as seen in IST.
export function istParts(date: Date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

// The UTC instant at which the IST calendar day containing `date` starts.
export function istStartOfDay(date: Date = new Date()): Date {
  const { year, month, day } = istParts(date)
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS)
}

export function istStartOfMonth(date: Date = new Date()): Date {
  const { year, month } = istParts(date)
  return new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

// A @db.Date value for "today in IST" (stored as midnight UTC of that date).
export function istDateOnly(date: Date = new Date()): Date {
  const { year, month, day } = istParts(date)
  return new Date(Date.UTC(year, month, day))
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function formatHour(hour: number): string {
  const h = ((hour + 11) % 12) + 1
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`
}

export function formatIstTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date).toUpperCase()
}

export function formatIstDate(date: Date, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date)
}

export function greetingFor(date: Date = new Date()): string {
  const { hour } = istParts(date)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
