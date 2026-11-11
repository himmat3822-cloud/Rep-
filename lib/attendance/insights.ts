import type { TenantDb } from '@/lib/db/tenant-core'
import { addDays, formatHour, istDateOnly, istParts, istStartOfDay } from '@/lib/time'

// Attendance analytics for the owner: hour x weekday heatmap, planned
// (slot bookings) vs actual check-ins, morning / afternoon / evening split,
// weekly trend, method mix.

export interface AttendanceInsights {
  heatmap: { weekday: number; hour: number; avg: number }[]
  heatMax: number
  hours: number[]
  plannedVsActual: { hour: number; label: string; planned: number; actual: number; capacity: number }[]
  dayparts: { label: string; count: number; pct: number }[]
  trend: { label: string; avgPerDay: number }[]
  methods: { method: string; count: number }[]
  busiest: string | null
  quietest: string | null
}

const WEEK_LABEL = (date: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date)

export async function getAttendanceInsights(db: TenantDb, branchId: string | null, now: Date = new Date()): Promise<AttendanceInsights> {
  const todayStart = istStartOfDay(now)
  const since28 = addDays(todayStart, -28)
  const since56 = addDays(todayStart, -56)
  const branchFilter = branchId ? { branchId } : {}
  const [last8w, slotsToday, todayCheckIns] = await Promise.all([
    db.checkIn.findMany({ where: { ...branchFilter, checkedInAt: { gte: since56, lt: todayStart } }, select: { checkedInAt: true, method: true } }),
    db.slot.findMany({ where: { ...branchFilter, date: istDateOnly(now) }, select: { startHour: true, booked: true, capacity: true } }),
    db.checkIn.findMany({ where: { ...branchFilter, checkedInAt: { gte: todayStart } }, select: { checkedInAt: true } }),
  ])

  const hours = Array.from({ length: 18 }, (_, index) => index + 5)
  const grid = new Map<string, number>()
  const dayparts = { morning: 0, afternoon: 0, evening: 0 }
  const methods = new Map<string, number>()
  for (const row of last8w) {
    const parts = istParts(row.checkedInAt)
    methods.set(row.method, (methods.get(row.method) ?? 0) + 1)
    if (row.checkedInAt < since28) continue
    const key = `${parts.weekday}:${parts.hour}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
    if (parts.hour < 12) dayparts.morning += 1
    else if (parts.hour < 17) dayparts.afternoon += 1
    else dayparts.evening += 1
  }
  const heatmap = [1, 2, 3, 4, 5, 6, 0].flatMap((weekday) => hours.map((hour) => ({ weekday, hour, avg: Math.round(((grid.get(`${weekday}:${hour}`) ?? 0) / 4) * 10) / 10 })))
  const heatMax = Math.max(1, ...heatmap.map((cell) => cell.avg))

  const actualByHour = new Map<number, number>()
  for (const row of todayCheckIns) {
    const hour = istParts(row.checkedInAt).hour
    actualByHour.set(hour, (actualByHour.get(hour) ?? 0) + 1)
  }
  const slotByHour = new Map<number, { planned: number; capacity: number }>()
  for (const slot of slotsToday) {
    const current = slotByHour.get(slot.startHour) ?? { planned: 0, capacity: 0 }
    slotByHour.set(slot.startHour, { planned: current.planned + slot.booked, capacity: current.capacity + slot.capacity })
  }
  const plannedVsActual = hours.map((hour) => ({ hour, label: formatHour(hour).replace(':00 ', ''), planned: slotByHour.get(hour)?.planned ?? 0, actual: actualByHour.get(hour) ?? 0, capacity: slotByHour.get(hour)?.capacity ?? 0 }))

  const totalParts = dayparts.morning + dayparts.afternoon + dayparts.evening || 1
  const trend = Array.from({ length: 8 }, (_, index) => {
    const start = addDays(since56, index * 7)
    const end = addDays(start, 7)
    const count = last8w.filter((row) => row.checkedInAt >= start && row.checkedInAt < end).length
    return { label: WEEK_LABEL(start), avgPerDay: Math.round((count / 7) * 10) / 10 }
  })

  const ranked = heatmap.filter((cell) => cell.avg > 0).sort((a, b) => b.avg - a.avg)
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    heatmap,
    heatMax,
    hours,
    plannedVsActual,
    dayparts: [
      { label: 'Morning (5 AM - 12 PM)', count: dayparts.morning, pct: Math.round((dayparts.morning / totalParts) * 100) },
      { label: 'Afternoon (12 - 5 PM)', count: dayparts.afternoon, pct: Math.round((dayparts.afternoon / totalParts) * 100) },
      { label: 'Evening (5 - 11 PM)', count: dayparts.evening, pct: Math.round((dayparts.evening / totalParts) * 100) },
    ],
    trend,
    methods: [...methods.entries()].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count),
    busiest: ranked[0] ? `${dayName[ranked[0].weekday]} ${formatHour(ranked[0].hour)}` : null,
    quietest: ranked.length ? `${dayName[ranked.at(-1)!.weekday]} ${formatHour(ranked.at(-1)!.hour)}` : null,
  }
}

// Live occupancy per branch (also served publicly, cached 30 s).
export async function getOccupancy(db: TenantDb, sessionMinutes: number, now: Date = new Date()) {
  const [branches, open] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true, hourlyCapacity: true }, orderBy: { createdAt: 'asc' } }),
    db.checkIn.groupBy({ by: ['branchId'], where: { checkedOutAt: null, checkedInAt: { gte: new Date(now.getTime() - sessionMinutes * 60000), lte: now } }, _count: { _all: true } }),
  ])
  const inside = new Map(open.map((row) => [row.branchId, row._count._all]))
  return branches.map((branch) => {
    const count = inside.get(branch.id) ?? 0
    return { id: branch.id, name: branch.name, inside: count, capacity: branch.hourlyCapacity, percent: branch.hourlyCapacity ? Math.min(100, Math.round((count / branch.hourlyCapacity) * 100)) : 0 }
  })
}
