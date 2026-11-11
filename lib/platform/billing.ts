// Rep+ subscription billing - PURE functions (no DB). The cron job and the
// Razorpay webhook load a snapshot, call these, and persist the patch.
//
//   TRIAL --trial ends unpaid--> PAST_DUE --3 days--> READ_ONLY --15 days from due--> SUSPENDED
//     \                              ^                                                    |
//      \--paid--> ACTIVE --due------/                       data kept 90 days ----------- +--> purge
//
// - Free months (admin gift) are consumed instead of going PAST_DUE.
// - cancelAtPeriodEnd: when the period ends the gym goes CANCELLED (not PAST_DUE).
// - manualOverride: an admin decision (revoke or goodwill restore) that the
//   automation must not undo. Only a payment or another admin action clears it.

export type BillingStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED'
export type Cycle = 'MONTHLY' | 'ANNUAL'

export const GRACE_DAYS = 3
export const SUSPEND_AFTER_DAYS = 15
export const RETENTION_DAYS = 90
export const TRIAL_DAYS = 14
export const GST_PERCENT = 18

const DAY_MS = 24 * 3600 * 1000

export interface BillingSnapshot {
  status: BillingStatus
  cycle: Cycle
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  nextDueAt: Date | null
  pastDueSince: Date | null
  suspendedAt: Date | null
  dataPurgeAfter: Date | null
  manualOverride: boolean
  cancelAtPeriodEnd: boolean
  freeMonthsLeft: number
}

export type BillingEvent = 'trial_ended' | 'free_month_used' | 'past_due' | 'read_only' | 'suspended' | 'cancelled' | 'purge_due'

export interface BillingResult {
  next: BillingSnapshot
  events: BillingEvent[]
  changed: boolean
}

export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

export function periodLength(cycle: Cycle): number {
  return cycle === 'ANNUAL' ? 12 : 1
}

function startPeriod(snapshot: BillingSnapshot, start: Date, months: number): BillingSnapshot {
  const end = addMonthsUtc(start, months)
  return {
    ...snapshot,
    status: 'ACTIVE',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    nextDueAt: end,
    pastDueSince: null,
    suspendedAt: null,
    dataPurgeAfter: null,
  }
}

function step(s: BillingSnapshot, now: Date): { next: BillingSnapshot; event: BillingEvent } | null {
  const nowMs = now.getTime()

  if (s.status === 'SUSPENDED' || s.status === 'CANCELLED') {
    if (s.dataPurgeAfter && s.dataPurgeAfter.getTime() <= nowMs) return { next: s, event: 'purge_due' }
    return null
  }
  if (s.manualOverride) return null

  if (s.status === 'TRIAL') {
    if (!s.trialEndsAt || s.trialEndsAt.getTime() > nowMs) return null
    if (s.freeMonthsLeft > 0) return { next: { ...startPeriod(s, s.trialEndsAt, 1), freeMonthsLeft: s.freeMonthsLeft - 1 }, event: 'free_month_used' }
    if (s.cancelAtPeriodEnd) return { next: { ...s, status: 'CANCELLED', dataPurgeAfter: new Date(nowMs + RETENTION_DAYS * DAY_MS) }, event: 'cancelled' }
    return { next: { ...s, status: 'PAST_DUE', pastDueSince: s.trialEndsAt, nextDueAt: s.trialEndsAt }, event: 'trial_ended' }
  }

  if (s.status === 'ACTIVE') {
    const due = s.nextDueAt ?? s.currentPeriodEnd
    if (!due || due.getTime() > nowMs) return null
    if (s.cancelAtPeriodEnd) return { next: { ...s, status: 'CANCELLED', dataPurgeAfter: new Date(due.getTime() + RETENTION_DAYS * DAY_MS) }, event: 'cancelled' }
    if (s.freeMonthsLeft > 0) return { next: { ...startPeriod(s, due, 1), freeMonthsLeft: s.freeMonthsLeft - 1 }, event: 'free_month_used' }
    return { next: { ...s, status: 'PAST_DUE', pastDueSince: due }, event: 'past_due' }
  }

  const since = s.pastDueSince ?? s.nextDueAt
  if (!since) return null
  const overdueMs = nowMs - since.getTime()

  if (s.status === 'PAST_DUE' && overdueMs >= GRACE_DAYS * DAY_MS) {
    return { next: { ...s, status: 'READ_ONLY', pastDueSince: since }, event: 'read_only' }
  }
  if (s.status === 'READ_ONLY' && overdueMs >= SUSPEND_AFTER_DAYS * DAY_MS) {
    const suspendedAt = new Date(since.getTime() + SUSPEND_AFTER_DAYS * DAY_MS)
    return { next: { ...s, status: 'SUSPENDED', suspendedAt, dataPurgeAfter: new Date(suspendedAt.getTime() + RETENTION_DAYS * DAY_MS) }, event: 'suspended' }
  }
  return null
}

// Runs the state machine until it settles (a gym that missed several cron
// runs can move TRIAL -> PAST_DUE -> READ_ONLY -> SUSPENDED in one pass).
export function evaluateBilling(snapshot: BillingSnapshot, now: Date = new Date()): BillingResult {
  let current = snapshot
  const events: BillingEvent[] = []
  for (let i = 0; i < 24; i += 1) {
    const result = step(current, now)
    if (!result) break
    events.push(result.event)
    if (result.event === 'purge_due') break
    current = result.next
  }
  return { next: current, events, changed: current !== snapshot }
}

// A successful payment always restores the gym, whatever state it was in.
// Paying early extends from the current period end; paying late starts a
// fresh period from the payment date.
export function applyPayment(snapshot: BillingSnapshot, paidAt: Date, cycle: Cycle = snapshot.cycle): BillingSnapshot {
  let start = paidAt
  if (snapshot.status === 'ACTIVE' && snapshot.currentPeriodEnd && snapshot.currentPeriodEnd.getTime() > paidAt.getTime()) start = snapshot.currentPeriodEnd
  if (snapshot.status === 'TRIAL' && snapshot.trialEndsAt && snapshot.trialEndsAt.getTime() > paidAt.getTime()) start = snapshot.trialEndsAt
  return { ...startPeriod({ ...snapshot, cycle }, start, periodLength(cycle)), manualOverride: false, cancelAtPeriodEnd: false }
}

// Admin "revoke": immediate suspension that automation will not undo.
export function adminSuspend(snapshot: BillingSnapshot, now: Date = new Date()): BillingSnapshot {
  return { ...snapshot, status: 'SUSPENDED', suspendedAt: now, dataPurgeAfter: new Date(now.getTime() + RETENTION_DAYS * DAY_MS), manualOverride: true }
}

// Admin "restore" without a payment: goodwill access. If the gym is still
// unpaid, the override keeps it ACTIVE until it pays or the admin clears it.
export function adminRestore(snapshot: BillingSnapshot, now: Date = new Date()): BillingSnapshot {
  const paidUp = snapshot.currentPeriodEnd && snapshot.currentPeriodEnd.getTime() > now.getTime()
  const inTrial = snapshot.trialEndsAt && snapshot.trialEndsAt.getTime() > now.getTime() && !snapshot.currentPeriodStart
  return {
    ...snapshot,
    status: inTrial ? 'TRIAL' : 'ACTIVE',
    pastDueSince: null,
    suspendedAt: null,
    dataPurgeAfter: null,
    manualOverride: !(paidUp || inTrial),
  }
}

export function extendTrial(snapshot: BillingSnapshot, days: number, now: Date = new Date()): BillingSnapshot {
  const base = snapshot.trialEndsAt && snapshot.trialEndsAt.getTime() > now.getTime() ? snapshot.trialEndsAt : now
  const trialEndsAt = new Date(base.getTime() + days * DAY_MS)
  return { ...snapshot, status: 'TRIAL', trialEndsAt, nextDueAt: trialEndsAt, pastDueSince: null, suspendedAt: null, dataPurgeAfter: null, manualOverride: false }
}

// ---------------------------------------------------------------------------
// Pricing (all paise, prices exclude GST)
// ---------------------------------------------------------------------------

export interface PricingInput {
  cycle: Cycle
  monthlyPricePaise: number
  annualPricePaise: number
  branchLimit: number
  extraBranchPaise: number | null
  customPricePaise?: number | null
  extraBranchesGranted?: number
  branchCount: number
}

export interface PriceBreakdown {
  basePaise: number
  extraBranches: number
  extraBranchesPaise: number
  subtotalPaise: number
  gstPaise: number
  totalPaise: number
  monthlyEquivalentPaise: number
}

export function priceFor(input: PricingInput): PriceBreakdown {
  const months = periodLength(input.cycle)
  const basePaise = input.customPricePaise ?? (input.cycle === 'ANNUAL' ? input.annualPricePaise : input.monthlyPricePaise)
  const allowed = input.branchLimit + (input.extraBranchesGranted ?? 0)
  const extraBranches = input.extraBranchPaise ? Math.max(0, input.branchCount - allowed) : 0
  // Annual = pay 10 months, get 12 - the same deal applies to extra branches.
  const extraBranchesPaise = extraBranches * (input.extraBranchPaise ?? 0) * (input.cycle === 'ANNUAL' ? 10 : 1)
  const subtotalPaise = basePaise + extraBranchesPaise
  const gstPaise = Math.round((subtotalPaise * GST_PERCENT) / 100)
  return {
    basePaise,
    extraBranches,
    extraBranchesPaise,
    subtotalPaise,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise,
    monthlyEquivalentPaise: Math.round(subtotalPaise / months),
  }
}

export function countsTowardMrr(status: BillingStatus): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE' || status === 'READ_ONLY'
}
