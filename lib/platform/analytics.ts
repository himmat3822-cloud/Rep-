import type { PrismaClient } from '@/lib/generated/prisma/client'
import { countsTowardMrr, priceFor } from './billing'
import { currentMonthKey } from './gyms'

// Platform analytics for the super admin home.

export interface MonthPoint {
  key: string
  label: string
  value: number
}

export interface PlatformAnalytics {
  totalGyms: number
  byStatus: Record<string, number>
  mrrPaise: number
  arrPaise: number
  churned: number
  revenue: MonthPoint[]
  newGyms: MonthPoint[]
  whatsapp: { sent: number; quota: number; top: { gymId: string; name: string; sent: number; quota: number }[] }
  overdue: { gymId: string; name: string; status: string; since: Date | null }[]
  purgeDue: { gymId: string; name: string; purgeAfter: Date }[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function lastTwelveMonths(now: Date): { key: string; label: string; start: Date; end: Date }[] {
  const out = []
  for (let i = 11; i >= 0; i -= 1) {
    const ist = new Date(now.getTime() + 330 * 60 * 1000)
    const year = ist.getUTCFullYear()
    const month = ist.getUTCMonth() - i
    const startIst = new Date(Date.UTC(year, month, 1))
    const endIst = new Date(Date.UTC(year, month + 1, 1))
    out.push({
      key: `${startIst.getUTCFullYear()}-${String(startIst.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MONTHS[startIst.getUTCMonth()],
      start: new Date(startIst.getTime() - 330 * 60 * 1000),
      end: new Date(endIst.getTime() - 330 * 60 * 1000),
    })
  }
  return out
}

export async function getPlatformAnalytics(db: PrismaClient, now: Date = new Date()): Promise<PlatformAnalytics> {
  const months = lastTwelveMonths(now)
  const [gyms, subs, invoices, usage] = await Promise.all([
    db.gym.findMany({ select: { id: true, name: true, createdAt: true, subscriptionStatus: true, _count: { select: { branches: { where: { archived: false } } } } } }),
    db.gymSubscription.findMany({ include: { plan: true } }),
    db.platformInvoice.findMany({ where: { status: 'PAID', paidAt: { gte: months[0].start } }, select: { amountPaise: true, paidAt: true } }),
    db.whatsAppUsage.findMany({ where: { month: currentMonthKey(now) } }),
  ])
  const overrides = await db.gymOverride.findMany()
  const overrideByGym = new Map(overrides.map((row) => [row.gymId, row]))
  const gymById = new Map(gyms.map((gym) => [gym.id, gym]))

  const byStatus: Record<string, number> = { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, READ_ONLY: 0, SUSPENDED: 0, CANCELLED: 0 }
  let mrrPaise = 0
  const quotaByGym = new Map<string, number>()
  for (const sub of subs) {
    byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1
    const override = overrideByGym.get(sub.gymId)
    quotaByGym.set(sub.gymId, sub.plan.whatsappQuota + (override?.whatsappTopUp ?? 0))
    if (!countsTowardMrr(sub.status)) continue
    mrrPaise += priceFor({
      cycle: sub.cycle,
      monthlyPricePaise: sub.plan.monthlyPricePaise,
      annualPricePaise: sub.plan.annualPricePaise,
      branchLimit: sub.plan.branchLimit,
      extraBranchPaise: sub.plan.extraBranchPaise,
      customPricePaise: override?.customPricePaise,
      extraBranchesGranted: override?.extraBranches,
      branchCount: gymById.get(sub.gymId)?._count.branches ?? 1,
    }).monthlyEquivalentPaise
  }

  const revenue = months.map((month) => ({
    key: month.key,
    label: month.label,
    value: invoices.filter((invoice) => invoice.paidAt && invoice.paidAt >= month.start && invoice.paidAt < month.end).reduce((sum, invoice) => sum + invoice.amountPaise, 0),
  }))
  const newGyms = months.map((month) => ({ key: month.key, label: month.label, value: gyms.filter((gym) => gym.createdAt >= month.start && gym.createdAt < month.end).length }))

  const top = usage
    .map((row) => ({ gymId: row.gymId, name: gymById.get(row.gymId)?.name ?? row.gymId, sent: row.sent, quota: quotaByGym.get(row.gymId) ?? 0 }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 6)

  const overdue = subs
    .filter((sub) => sub.status === 'PAST_DUE' || sub.status === 'READ_ONLY' || sub.status === 'SUSPENDED')
    .map((sub) => ({ gymId: sub.gymId, name: gymById.get(sub.gymId)?.name ?? '-', status: sub.status, since: sub.pastDueSince ?? sub.suspendedAt }))
  const purgeDue = subs
    .filter((sub) => sub.dataPurgeAfter && sub.dataPurgeAfter <= now)
    .map((sub) => ({ gymId: sub.gymId, name: gymById.get(sub.gymId)?.name ?? '-', purgeAfter: sub.dataPurgeAfter as Date }))

  return {
    totalGyms: gyms.length,
    byStatus,
    mrrPaise,
    arrPaise: mrrPaise * 12,
    churned: byStatus.CANCELLED + byStatus.SUSPENDED,
    revenue,
    newGyms,
    whatsapp: { sent: usage.reduce((sum, row) => sum + row.sent, 0), quota: [...quotaByGym.values()].reduce((a, b) => a + b, 0), top },
    overdue,
    purgeDue,
  }
}
