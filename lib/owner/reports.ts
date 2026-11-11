import type { TenantDb } from '@/lib/db/tenant-core'
import { addDays, daysBetween, istDateOnly, istParts, IST_OFFSET_MS } from '@/lib/time'
import { leadFunnel } from './leads'

// Owner reports. Every number is computed from the source tables (no
// cached totals), month buckets are IST calendar months, money is paise.

export interface MonthBucket {
  key: string // 2026-11
  label: string // Nov 2026
  start: Date // UTC instant of IST midnight on the 1st
  end: Date
  startDate: Date // date-only
  endDate: Date // last day, date-only
}

export function monthBuckets(months: number, now: Date = new Date()): MonthBucket[] {
  const { year, month } = istParts(now)
  return Array.from({ length: months }, (_, i) => {
    const offset = i - (months - 1)
    const first = new Date(Date.UTC(year, month + offset, 1))
    const next = new Date(Date.UTC(year, month + offset + 1, 1))
    return {
      key: first.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(first),
      start: new Date(first.getTime() - IST_OFFSET_MS),
      end: new Date(next.getTime() - IST_OFFSET_MS),
      startDate: first,
      endDate: addDays(next, -1),
    }
  })
}

function bucketOf(buckets: MonthBucket[], at: Date): MonthBucket | undefined {
  return buckets.find((b) => at >= b.start && at < b.end)
}

// ---------------------------------------------------------------------------

export interface RevenueRow {
  month: string
  cash: number
  upi: number
  card: number
  bank: number
  total: number
  gst: number
  payments: number
}

export async function revenueReport(db: TenantDb, months: number, now: Date = new Date()): Promise<RevenueRow[]> {
  const buckets = monthBuckets(months, now)
  const [payments, invoices] = await Promise.all([
    db.payment.findMany({ where: { status: 'PAID', paidAt: { gte: buckets[0].start, lt: buckets.at(-1)!.end } }, select: { amountPaise: true, method: true, paidAt: true } }),
    db.invoice.findMany({ where: { issuedAt: { gte: buckets[0].start, lt: buckets.at(-1)!.end } }, select: { cgstPaise: true, sgstPaise: true, igstPaise: true, issuedAt: true } }),
  ])
  const rows = new Map(buckets.map((b) => [b.key, { month: b.label, cash: 0, upi: 0, card: 0, bank: 0, total: 0, gst: 0, payments: 0 }]))
  for (const p of payments) {
    const b = p.paidAt && bucketOf(buckets, p.paidAt)
    if (!b) continue
    const row = rows.get(b.key)!
    const key = p.method === 'CASH' ? 'cash' : p.method === 'UPI' ? 'upi' : p.method === 'CARD' ? 'card' : 'bank'
    row[key] += p.amountPaise
    row.total += p.amountPaise
    row.payments += 1
  }
  for (const inv of invoices) {
    const b = bucketOf(buckets, inv.issuedAt)
    if (b) rows.get(b.key)!.gst += inv.cgstPaise + inv.sgstPaise + inv.igstPaise
  }
  return [...rows.values()]
}

export interface MembersRow {
  month: string
  joined: number
  activeAtEnd: number
  expired: number
  renewed: number
  churnPct: number
}

export async function membersReport(db: TenantDb, months: number, now: Date = new Date()): Promise<MembersRow[]> {
  const buckets = monthBuckets(months, now)
  const [athletes, memberships] = await Promise.all([
    db.athlete.findMany({ where: { joinedAt: { gte: buckets[0].start } }, select: { joinedAt: true } }),
    db.membership.findMany({ where: { status: { not: 'CANCELLED' }, endsAt: { gte: addDays(buckets[0].startDate, -1) } }, select: { athleteId: true, startsAt: true, endsAt: true } }),
  ])
  return buckets.map((b) => {
    const joined = athletes.filter((a) => a.joinedAt >= b.start && a.joinedAt < b.end).length
    const at = b.endDate < istDateOnly(now) ? b.endDate : istDateOnly(now)
    const activeAtEnd = new Set(memberships.filter((m) => m.startsAt <= at && m.endsAt >= at).map((m) => m.athleteId)).size
    const activeAtStart = new Set(memberships.filter((m) => m.startsAt <= b.startDate && m.endsAt >= b.startDate).map((m) => m.athleteId)).size
    const endedHere = memberships.filter((m) => m.endsAt >= b.startDate && m.endsAt <= b.endDate && m.endsAt < istDateOnly(now))
    let expired = 0
    let renewed = 0
    for (const m of endedHere) {
      const next = memberships.some((o) => o.athleteId === m.athleteId && o.startsAt > m.startsAt && o.startsAt <= addDays(m.endsAt, 15))
      if (next) renewed += 1
      else expired += 1
    }
    return { month: b.label, joined, activeAtEnd, expired, renewed, churnPct: activeAtStart ? Math.round((expired / activeAtStart) * 1000) / 10 : 0 }
  })
}

export interface AttendanceRow {
  month: string
  visits: number
  members: number
  perDay: number
}

export async function attendanceReport(db: TenantDb, months: number, now: Date = new Date()): Promise<{ months: AttendanceRow[]; hours: { hour: number; visits: number }[] }> {
  const buckets = monthBuckets(months, now)
  const visits = await db.checkIn.findMany({ where: { checkedInAt: { gte: buckets[0].start } }, select: { athleteId: true, checkedInAt: true } })
  const rows = buckets.map((b) => {
    const inMonth = visits.filter((v) => v.checkedInAt >= b.start && v.checkedInAt < b.end)
    const days = b.end > now ? Math.max(1, daysBetween(b.startDate, istDateOnly(now)) + 1) : daysBetween(b.startDate, b.endDate) + 1
    return { month: b.label, visits: inMonth.length, members: new Set(inMonth.map((v) => v.athleteId)).size, perDay: Math.round((inMonth.length / days) * 10) / 10 }
  })
  const since = new Date(now.getTime() - 30 * 86400000)
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }))
  for (const v of visits) if (v.checkedInAt >= since) hours[istParts(v.checkedInAt).hour].visits += 1
  return { months: rows, hours: hours.filter((h) => h.visits > 0) }
}

export interface DuesAging {
  bucket: string
  count: number
  amount: number
}

export async function duesReport(db: TenantDb, now: Date = new Date()) {
  const today = istDateOnly(now)
  const dues = await db.due.findMany({ where: { status: 'OPEN' }, orderBy: { dueDate: 'asc' } })
  const athletes = await db.athlete.findMany({ where: { id: { in: [...new Set(dues.map((d) => d.athleteId))] } }, select: { id: true, name: true, memberCode: true, phone: true } })
  const byId = new Map(athletes.map((a) => [a.id, a]))
  const labels = ['Not due yet', '1-7 days late', '8-30 days late', '31-60 days late', '60+ days late'] as const
  const aging: DuesAging[] = labels.map((bucket) => ({ bucket, count: 0, amount: 0 }))
  const rows = dues.map((due) => {
    const late = daysBetween(due.dueDate, today)
    const index = late <= 0 ? 0 : late <= 7 ? 1 : late <= 30 ? 2 : late <= 60 ? 3 : 4
    aging[index].count += 1
    aging[index].amount += due.amountPaise
    const a = byId.get(due.athleteId)
    return { member: a?.name ?? '', memberCode: a?.memberCode ?? '', phone: a?.phone ?? '', amountPaise: due.amountPaise, dueDate: due.dueDate.toISOString().slice(0, 10), daysLate: Math.max(0, late), reminderStage: due.reminderStage }
  })
  return { aging, rows }
}

export async function ptReport(db: TenantDb, months: number, now: Date = new Date()) {
  const buckets = monthBuckets(months, now)
  const [sessions, trainers] = await Promise.all([
    db.ptSession.findMany({ where: { sessionAt: { gte: buckets[0].start } }, select: { trainerId: true, sessionAt: true, athleteSignedAt: true, commissionPaise: true } }),
    db.gymUser.findMany({ where: { kind: { in: ['TRAINER', 'OWNER'] } }, select: { id: true, name: true } }),
  ])
  const name = new Map(trainers.map((t) => [t.id, t.name]))
  const rows: { month: string; trainer: string; sessions: number; confirmed: number; commissionPaise: number }[] = []
  for (const b of buckets) {
    const inMonth = sessions.filter((s) => s.sessionAt >= b.start && s.sessionAt < b.end)
    for (const trainerId of new Set(inMonth.map((s) => s.trainerId))) {
      const mine = inMonth.filter((s) => s.trainerId === trainerId)
      const confirmed = mine.filter((s) => s.athleteSignedAt)
      rows.push({ month: b.label, trainer: name.get(trainerId) ?? 'Trainer', sessions: mine.length, confirmed: confirmed.length, commissionPaise: confirmed.reduce((sum, s) => sum + s.commissionPaise, 0) })
    }
  }
  return rows
}

export interface ProfitRow {
  month: string
  revenue: number
  expenses: number
  commission: number
  profit: number
  byCategory: Record<string, number>
}

export async function profitReport(db: TenantDb, months: number, now: Date = new Date()): Promise<ProfitRow[]> {
  const buckets = monthBuckets(months, now)
  const [revenue, expenses, pt] = await Promise.all([
    revenueReport(db, months, now),
    db.expense.findMany({ where: { spentOn: { gte: buckets[0].startDate } }, select: { category: true, amountPaise: true, spentOn: true } }),
    ptReport(db, months, now),
  ])
  return buckets.map((b, i) => {
    const mine = expenses.filter((e) => e.spentOn >= b.startDate && e.spentOn <= b.endDate)
    const byCategory: Record<string, number> = {}
    for (const e of mine) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amountPaise
    const spent = mine.reduce((sum, e) => sum + e.amountPaise, 0)
    const commission = pt.filter((r) => r.month === b.label).reduce((sum, r) => sum + r.commissionPaise, 0)
    // Revenue includes GST collected; profit is shown before tax on the GST-exclusive amount.
    const net = revenue[i].total - revenue[i].gst
    return { month: b.label, revenue: net, expenses: spent, commission, profit: net - spent - commission, byCategory }
  })
}

export async function leadsReport(db: TenantDb, months: number, now: Date = new Date()) {
  const buckets = monthBuckets(months, now)
  const [funnel, leads] = await Promise.all([leadFunnel(db, buckets[0].start), db.lead.findMany({ where: { createdAt: { gte: buckets[0].start } }, select: { createdAt: true, stage: true } })])
  const monthly = buckets.map((b) => {
    const mine = leads.filter((l) => l.createdAt >= b.start && l.createdAt < b.end)
    return { month: b.label, leads: mine.length, joined: mine.filter((l) => l.stage === 'JOINED').length, lost: mine.filter((l) => l.stage === 'LOST').length }
  })
  return { funnel, monthly }
}
