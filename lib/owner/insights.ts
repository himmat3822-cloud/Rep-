import type { TenantDb } from '@/lib/db/tenant-core'
import { groqChat } from '@/lib/integrations/groq'
import { formatInr } from '@/lib/money'
import { attendanceReport, duesReport, leadsReport, membersReport, revenueReport } from './reports'
import { RISK_THRESHOLD } from './risk'
import { mondayOf } from '@/lib/attendance/jobs'
import { istDateOnly, formatHour } from '@/lib/time'

// AI insights for the owner (Elite): the facts are computed here, Groq only
// turns them into short, plain-language advice. If Groq is not configured
// or fails, rule-based insights from the same facts are returned instead.

export interface InsightFacts {
  revenueThisMonth: number
  revenueLastMonth: number
  revenueChangePct: number | null
  activeMembers: number
  joinedThisMonth: number
  churnPctLastMonth: number
  atRisk: number
  overdueCount: number
  overdueAmount: number
  oldOverdueCount: number
  peakHour: number | null
  quietHour: number | null
  visitsPerDay: number
  leadConversionPct: number | null
  bestLeadSource: string | null
  openFollowUps: number
}

export async function gatherFacts(db: TenantDb, now: Date = new Date()): Promise<InsightFacts> {
  const [revenue, members, attendance, dues, leads, atRisk, followUps] = await Promise.all([
    revenueReport(db, 2, now),
    membersReport(db, 2, now),
    attendanceReport(db, 1, now),
    duesReport(db, now),
    leadsReport(db, 3, now),
    db.riskScore.count({ where: { weekOf: mondayOf(istDateOnly(now)), score: { gte: RISK_THRESHOLD }, contacted: false } }),
    db.lead.count({ where: { stage: { in: ['NEW', 'TRIAL', 'FOLLOW_UP'] }, nextFollowUpAt: { lte: now } } }),
  ])
  const [last, current] = revenue
  const overdue = dues.aging.slice(1)
  const hours = [...attendance.hours].sort((a, b) => b.visits - a.visits)
  const totalLeads = leads.funnel.reduce((sum, row) => sum + row.total, 0)
  const joined = leads.funnel.reduce((sum, row) => sum + row.joined, 0)
  const best = leads.funnel.filter((row) => row.total >= 3).sort((a, b) => b.conversion - a.conversion)[0]
  return {
    revenueThisMonth: current.total,
    revenueLastMonth: last.total,
    revenueChangePct: last.total ? Math.round(((current.total - last.total) / last.total) * 100) : null,
    activeMembers: members[1].activeAtEnd,
    joinedThisMonth: members[1].joined,
    churnPctLastMonth: members[0].churnPct,
    atRisk,
    overdueCount: overdue.reduce((sum, b) => sum + b.count, 0),
    overdueAmount: overdue.reduce((sum, b) => sum + b.amount, 0),
    oldOverdueCount: dues.aging[3].count + dues.aging[4].count,
    peakHour: hours[0]?.hour ?? null,
    quietHour: hours.length > 3 ? hours[hours.length - 1].hour : null,
    visitsPerDay: attendance.months[0]?.perDay ?? 0,
    leadConversionPct: totalLeads ? Math.round((joined / totalLeads) * 100) : null,
    bestLeadSource: best ? best.source.toLowerCase().replace('_', '-') : null,
    openFollowUps: followUps,
  }
}

// Plain rules on the same facts - used when Groq is unavailable.
export function ruleInsights(f: InsightFacts): string[] {
  const out: string[] = []
  if (f.revenueChangePct !== null) {
    out.push(
      f.revenueChangePct >= 0
        ? `Collections are up ${f.revenueChangePct}% on last month so far (${formatInr(f.revenueThisMonth)}).`
        : `Collections are ${Math.abs(f.revenueChangePct)}% behind last month so far (${formatInr(f.revenueThisMonth)} vs ${formatInr(f.revenueLastMonth)}). Push renewals this week.`,
    )
  }
  if (f.overdueCount) out.push(`${f.overdueCount} dues worth ${formatInr(f.overdueAmount)} are overdue${f.oldOverdueCount ? `; ${f.oldOverdueCount} are over a month old, call those members personally` : ''}.`)
  if (f.atRisk) out.push(`${f.atRisk} members are on this week's at-risk list. A call this week saves more renewals than a discount later.`)
  if (f.churnPctLastMonth >= 8) out.push(`Last month ${f.churnPctLastMonth}% of members did not renew. Remind plans 7 days before they end and offer early renewal.`)
  if (f.peakHour !== null && f.quietHour !== null) out.push(`Busiest hour is ${formatHour(f.peakHour)}, quietest is ${formatHour(f.quietHour)}. Run an off-peak offer or group class in the quiet slot.`)
  if (f.leadConversionPct !== null) out.push(`${f.leadConversionPct}% of leads from the last 3 months joined${f.bestLeadSource ? `; ${f.bestLeadSource} converts best` : ''}${f.openFollowUps ? `. ${f.openFollowUps} follow-ups are due now` : ''}.`)
  if (f.joinedThisMonth) out.push(`${f.joinedThisMonth} new members joined this month. Make sure each one gets a workout plan in their first week.`)
  return out.slice(0, 6)
}

export async function ownerInsights(db: TenantDb, gymName: string, now: Date = new Date(), generate: typeof groqChat = groqChat): Promise<{ source: 'groq' | 'rules'; insights: string[]; facts: InsightFacts }> {
  const facts = await gatherFacts(db, now)
  const fallback = ruleInsights(facts)
  const factsText = [
    `Revenue this month so far: ${formatInr(facts.revenueThisMonth)} (last month: ${formatInr(facts.revenueLastMonth)}).`,
    `Active members: ${facts.activeMembers}. Joined this month: ${facts.joinedThisMonth}. Last month churn: ${facts.churnPctLastMonth}%.`,
    `At-risk members this week (not yet called): ${facts.atRisk}.`,
    `Overdue dues: ${facts.overdueCount} worth ${formatInr(facts.overdueAmount)}; older than a month: ${facts.oldOverdueCount}.`,
    `Average visits per day this month: ${facts.visitsPerDay}. Peak hour: ${facts.peakHour === null ? 'unknown' : formatHour(facts.peakHour)}. Quiet hour: ${facts.quietHour === null ? 'unknown' : formatHour(facts.quietHour)}.`,
    `Lead conversion (3 months): ${facts.leadConversionPct ?? 'no leads'}%. Best source: ${facts.bestLeadSource ?? 'n/a'}. Follow-ups due now: ${facts.openFollowUps}.`,
  ].join('\n')
  const raw = await generate(
    [
      { role: 'system', content: 'You advise owners of small Indian gyms. Using ONLY the facts given, write 4 to 6 short insights, each one sentence with a concrete action for this week. Use Indian rupee formatting as given. No markdown, no numbering, no invented numbers. Output a JSON array of strings only.' },
      { role: 'user', content: `Gym: ${gymName}\n${factsText}` },
    ],
    { temperature: 0.4, maxTokens: 700 },
  )
  if (raw) {
    try {
      const start = raw.indexOf('[')
      const end = raw.lastIndexOf(']')
      const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        const lines = parsed.filter((x): x is string => typeof x === 'string' && x.length > 10 && x.length < 300).slice(0, 6)
        if (lines.length >= 3) return { source: 'groq', insights: lines, facts }
      }
    } catch {
      // fall through to rules
    }
  }
  return { source: 'rules', insights: fallback, facts }
}
