import 'server-only'
import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { toE164 } from '@/lib/phone'
import { randomCode } from '@/lib/crypto'
import { invoicePrefixFor } from '@/lib/gst'
import { parseGymSettings } from '@/lib/gym/settings'
import { getGymLimits } from './limits'
import { parseDate, parseGender, parseMoney, type RawImportRow } from '@/lib/import/members-file'
import { istDateOnly } from '@/lib/time'

// Bulk member import from the old software's export. Two steps:
//   1. preview (dryRun): every row is checked, nothing is written.
//   2. commit: the same checks run again, then members, their current plan
//      (membership) and any balance due are created.
// Rows that fail are skipped, never half-written. Existing mobile numbers
// are skipped too, so running the same file twice adds nobody twice.

export const MAX_IMPORT_ROWS = 2000

export interface ImportRowResult {
  row: number
  name: string
  phone: string | null
  action: 'create' | 'skip' | 'error'
  messages: string[]
  plan: string | null
  endsOn: string | null
  active: boolean
  duePaise: number
}

export interface ImportSummary {
  total: number
  create: number
  skip: number
  error: number
  activePlans: number
  expiredPlans: number
  duesPaise: number
  dueCount: number
  newPlans: string[]
  limit: { used: number; limit: number | null }
  rows: ImportRowResult[]
}

interface PlannedRow {
  result: ImportRowResult
  data?: {
    name: string
    phone: string
    email: string | null
    gender: string | null
    dob: string | null
    joined: string
    branchId: string
    trainerId: string | null
    notes: string
    plan: { name: string; existingId: string | null; durationDays: number; pricePaise: number } | null
    start: string | null
    end: string | null
    paidPaise: number | null
    duePaise: number
  }
}

const DAY = 86400000
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10)
const lower = (value: string) => value.trim().toLowerCase()

async function plan(db: TenantDb, rows: RawImportRow[], defaultBranchId: string | null): Promise<{ planned: PlannedRow[]; newPlans: Map<string, { durationDays: number; pricePaise: number }> }> {
  if (rows.length > MAX_IMPORT_ROWS) throw new ApiError(422, 'VALIDATION_ERROR', `One file can have up to ${MAX_IMPORT_ROWS} members. Split it into smaller files.`)
  const [branches, staff, plans, existing] = await Promise.all([
    db.branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    db.gymUser.findMany({ where: { active: true, kind: { in: ['TRAINER', 'OWNER'] } }, select: { id: true, name: true } }),
    db.membershipPlan.findMany({ where: { active: true }, select: { id: true, name: true, durationDays: true, pricePaise: true } }),
    db.athlete.findMany({ select: { phone: true, name: true, archived: true } }),
  ])
  if (branches.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'Add a branch first (Settings > Branches)')
  const fallbackBranch = branches.find((branch) => branch.id === defaultBranchId) ?? branches[0]
  const existingByPhone = new Map(existing.map((athlete) => [athlete.phone, athlete]))
  const seen = new Map<string, number>()
  const newPlans = new Map<string, { durationDays: number; pricePaise: number }>()
  const today = istDateOnly().toISOString().slice(0, 10)

  const planned = rows.map((raw, index): PlannedRow => {
    const rowNumber = index + 2 // header is row 1 in the sheet
    const messages: string[] = []
    const name = (raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const phone = raw.phone ? toE164(raw.phone) : null
    const result: ImportRowResult = { row: rowNumber, name: name || '(no name)', phone, action: 'create', messages, plan: null, endsOn: null, active: false, duePaise: 0 }

    if (!name) messages.push('Name is missing')
    if (!raw.phone) messages.push('Mobile number is missing')
    else if (!phone) messages.push(`"${raw.phone}" is not a valid mobile number`)
    if (messages.length) return { result: { ...result, action: 'error' } }

    const previousRow = seen.get(phone!)
    if (previousRow) return { result: { ...result, action: 'error', messages: [`Same mobile number as row ${previousRow}`] } }
    seen.set(phone!, rowNumber)
    const already = existingByPhone.get(phone!)
    if (already) return { result: { ...result, action: 'skip', messages: [`Already in Rep+ as ${already.name}${already.archived ? ' (archived)' : ''} - skipped`] } }

    let branchId = fallbackBranch.id
    if (raw.branch) {
      const match = branches.find((branch) => lower(branch.name) === lower(raw.branch!)) ?? branches.find((branch) => lower(branch.name).includes(lower(raw.branch!)) || lower(raw.branch!).includes(lower(branch.name)))
      if (match) branchId = match.id
      else messages.push(`Branch "${raw.branch}" not found - added to ${fallbackBranch.name}`)
    }

    let trainerId: string | null = null
    if (raw.trainer) {
      const wanted = lower(raw.trainer)
      const match = staff.find((person) => lower(person.name) === wanted) ?? staff.find((person) => lower(person.name).split(' ')[0] === wanted.split(' ')[0])
      if (match) trainerId = match.id
      else messages.push(`Trainer "${raw.trainer}" not found - no trainer set`)
    }

    const email = raw.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email) ? raw.email.toLowerCase().slice(0, 120) : null
    if (raw.email && !email) messages.push(`Email "${raw.email}" ignored`)
    const dob = parseDate(raw.dob)
    if (raw.dob && !dob) messages.push(`Date of birth "${raw.dob}" not understood - ignored`)
    const joinedParsed = parseDate(raw.joined)
    if (raw.joined && !joinedParsed) messages.push(`Joining date "${raw.joined}" not understood - ignored`)
    const startParsed = parseDate(raw.start)
    if (raw.start && !startParsed) messages.push(`Start date "${raw.start}" not understood - ignored`)
    const end = parseDate(raw.end)
    if (raw.end && !end) messages.push(`End date "${raw.end}" not understood - no plan added`)
    const paidPaise = parseMoney(raw.paid)
    if (raw.paid && paidPaise === null) messages.push(`Amount paid "${raw.paid}" ignored`)
    const duePaise = parseMoney(raw.due) ?? 0
    if (raw.due && parseMoney(raw.due) === null) messages.push(`Balance "${raw.due}" ignored`)

    // The member's current plan: needs an end date to know if it is running.
    let planInfo: NonNullable<PlannedRow['data']>['plan'] = null
    let start: string | null = startParsed
    if (end) {
      const planName = (raw.plan ?? '').trim().slice(0, 60) || 'Imported plan'
      const existingPlan = plans.find((p) => lower(p.name) === lower(planName))
      const span = startParsed && days(startParsed, end) > 0 ? days(startParsed, end) : null
      const durationDays = existingPlan?.durationDays ?? span ?? 30
      if (!start) start = addDaysIso(end, -durationDays)
      if (days(start, end) <= 0) {
        messages.push('Plan end date is before its start date - no plan added')
      } else {
        planInfo = { name: existingPlan?.name ?? planName, existingId: existingPlan?.id ?? null, durationDays, pricePaise: existingPlan?.pricePaise ?? paidPaise ?? 0 }
        if (!existingPlan && !newPlans.has(lower(planName))) newPlans.set(lower(planName), { durationDays: span ?? 30, pricePaise: paidPaise ?? 0 })
        result.plan = planInfo.name
        result.endsOn = end
        result.active = end >= today
      }
    } else if (raw.plan) {
      messages.push('Plan has no end date - only the member is added')
    }
    result.duePaise = duePaise

    const notes = [raw.code ? `Old member ID: ${raw.code}` : '', raw.notes ?? ''].filter(Boolean).join('. ').slice(0, 500)
    return {
      result,
      data: { name, phone: phone!, email, gender: parseGender(raw.gender), dob, joined: joinedParsed ?? start ?? today, branchId, trainerId, notes, plan: planInfo, start, end: planInfo ? end : null, paidPaise, duePaise },
    }
  })
  return { planned, newPlans }
}

function summarize(planned: PlannedRow[], newPlans: Map<string, unknown>, limit: { used: number; limit: number | null }): ImportSummary {
  const rows = planned.map((item) => item.result)
  const creating = planned.filter((item) => item.result.action === 'create')
  return {
    total: rows.length,
    create: creating.length,
    skip: rows.filter((row) => row.action === 'skip').length,
    error: rows.filter((row) => row.action === 'error').length,
    activePlans: creating.filter((item) => item.result.plan && item.result.active).length,
    expiredPlans: creating.filter((item) => item.result.plan && !item.result.active).length,
    duesPaise: creating.reduce((sum, item) => sum + item.result.duePaise, 0),
    dueCount: creating.filter((item) => item.result.duePaise > 0).length,
    newPlans: [...newPlans.keys()].map((key) => creating.find((item) => item.result.plan && lower(item.result.plan) === key)?.result.plan ?? key),
    limit,
    rows,
  }
}

export async function previewImport(db: TenantDb, rows: RawImportRow[], defaultBranchId: string | null): Promise<ImportSummary> {
  const [{ planned, newPlans }, limits] = await Promise.all([plan(db, rows, defaultBranchId), getGymLimits(db)])
  return summarize(planned, newPlans, limits.members)
}

export async function commitImport(db: TenantDb, gym: { id: string; name: string; settings: unknown }, rows: RawImportRow[], defaultBranchId: string | null): Promise<ImportSummary> {
  const [{ planned, newPlans }, limits] = await Promise.all([plan(db, rows, defaultBranchId), getGymLimits(db)])
  const summary = summarize(planned, newPlans, limits.members)
  const creating = planned.filter((item): item is PlannedRow & { data: NonNullable<PlannedRow['data']> } => item.result.action === 'create' && Boolean(item.data))
  if (creating.length === 0) return summary
  if (limits.members.limit !== null && limits.members.used + creating.length > limits.members.limit) {
    throw new ApiError(403, 'FEATURE_NOT_IN_PLAN', `Your plan allows ${limits.members.limit} members. You have ${limits.members.used}, and this file adds ${creating.length}. Upgrade your Rep+ plan or import fewer rows.`)
  }

  // Plans the gym does not have yet are created once, from the file.
  const planIds = new Map<string, string>()
  const maxSort = await db.membershipPlan.count()
  let sort = maxSort
  for (const [key, info] of newPlans) {
    const label = creating.find((item) => item.data.plan && lower(item.data.plan.name) === key)?.data.plan?.name ?? key
    const created = await db.membershipPlan.create({ data: { gymId: gym.id, name: label, durationDays: info.durationDays, pricePaise: info.pricePaise, gstPercent: 18, gstInclusive: true, sortOrder: (sort += 1) } })
    planIds.set(key, created.id)
  }

  // Member codes continue after the highest existing one (PREFIX1001, ...).
  const prefix = parseGymSettings(gym.settings).invoicePrefix ?? invoicePrefixFor(gym.name)
  const codes = await db.athlete.findMany({ select: { memberCode: true } })
  let next = 1000
  for (const { memberCode } of codes) {
    const number = Number(memberCode.replace(/^\D+/, ''))
    if (Number.isFinite(number) && number > next) next = number
  }
  const today = istDateOnly()
  const todayIso = today.toISOString().slice(0, 10)

  for (let offset = 0; offset < creating.length; offset += 100) {
    const chunk = creating.slice(offset, offset + 100)
    const athletes = await db.athlete.createManyAndReturn({
      data: chunk.map((item) => {
        next += 1
        const first = item.data.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'FIT'
        const expired = item.data.end !== null && item.data.end < todayIso
        return {
          gymId: gym.id,
          homeBranchId: item.data.branchId,
          trainerId: item.data.trainerId,
          memberCode: `${prefix}${next}`,
          name: item.data.name,
          phone: item.data.phone,
          email: item.data.email,
          gender: item.data.gender,
          dateOfBirth: item.data.dob ? new Date(item.data.dob) : null,
          joinedAt: new Date(item.data.joined),
          language: 'EN' as const,
          referralCode: `${first}${randomCode(6)}`,
          restDays: [0],
          status: expired ? ('EXPIRED' as const) : ('NEW' as const),
          notes: item.data.notes,
        }
      }),
      select: { id: true, phone: true },
    })
    const idByPhone = new Map(athletes.map((athlete) => [athlete.phone, athlete.id]))

    const memberships = chunk
      .filter((item) => item.data.plan && item.data.start && item.data.end)
      .map((item) => ({
        gymId: gym.id,
        athleteId: idByPhone.get(item.data.phone)!,
        planId: item.data.plan!.existingId ?? planIds.get(lower(item.data.plan!.name))!,
        status: item.data.end! >= todayIso ? ('ACTIVE' as const) : ('EXPIRED' as const),
        startsAt: new Date(item.data.start!),
        endsAt: new Date(item.data.end!),
        pricePaise: item.data.paidPaise ?? item.data.plan!.pricePaise,
      }))
    if (memberships.length) await db.membership.createMany({ data: memberships })

    const dues = chunk
      .filter((item) => item.data.duePaise > 0)
      .map((item) => ({ gymId: gym.id, athleteId: idByPhone.get(item.data.phone)!, amountPaise: item.data.duePaise, dueDate: today, status: 'OPEN' as const }))
    if (dues.length) await db.due.createMany({ data: dues })
  }
  return summary
}
