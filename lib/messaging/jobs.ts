import { Prisma, type PrismaClient } from '@/lib/generated/prisma/client'
import { resolveFeatures, type FeatureKey } from '@/lib/features'
import { parseGymSettings } from '@/lib/gym/settings'
import { istDateOnly, istParts } from '@/lib/time'
import { isQuietHour } from './policy'
import { loadMessagingContext, type Transport } from './send'
import type { PushTransport } from '@/lib/athlete/push'
import { runDueReminders, type DueRunSummary } from './dues'
import { reportWeekFor, runRenewalReminders, runSlotReminders, runWeeklyReports, runWishes, type JobCount } from './scheduled'
import { generateMotivationForGym, type LineGenerator, type MotivationSummary } from './motivation'

// /api/cron/messages runs this. Safe to call every hour or once a day:
// daily jobs claim a JobRun key ("dues:<gymId>:<date>") so they run once,
// and every message has its own dedupe key on top of that.
//   dues + renewals - once a day from the gym's send hour (default 10 AM)
//   wishes          - once a day from 9 AM
//   weekly report   - Sunday from 6 PM (or Monday morning on a daily cron)
//   slot reminders  - every run (needs an hourly cron to be useful)

export type MessageJob = 'dues' | 'renewals' | 'wishes' | 'weekly' | 'slots'
export const MESSAGE_JOBS: MessageJob[] = ['dues', 'renewals', 'wishes', 'weekly', 'slots']

export interface GymMessageRun {
  gymId: string
  dues?: DueRunSummary
  renewals?: JobCount
  wishes?: { birthdays: JobCount; anniversaries: JobCount }
  weekly?: JobCount
  slots?: JobCount
  error?: string
}

export async function featuresFor(db: PrismaClient, gymId: string): Promise<FeatureKey[]> {
  const [subscription, override] = await Promise.all([
    db.gymSubscription.findUnique({ where: { gymId }, select: { plan: { select: { features: true } } } }),
    db.gymOverride.findUnique({ where: { gymId }, select: { extraFeatures: true, removedFeatures: true } }),
  ])
  if (!subscription) return []
  return resolveFeatures(subscription.plan.features, override?.extraFeatures ?? [], override?.removedFeatures ?? [])
}

export async function claimJob(db: PrismaClient, key: string): Promise<boolean> {
  try {
    await db.jobRun.create({ data: { key } })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
    throw error
  }
}

async function releaseJob(db: PrismaClient, key: string) {
  await db.jobRun.deleteMany({ where: { key } })
}

// Run `fn` once per key; a crash releases the key so the next run retries.
async function once<T>(db: PrismaClient, key: string, force: boolean, fn: () => Promise<T>): Promise<T | undefined> {
  if (!force && !(await claimJob(db, key))) return undefined
  try {
    return await fn()
  } catch (error) {
    if (!force) await releaseJob(db, key)
    throw error
  }
}

export interface RunOptions {
  force?: MessageJob[]
  gymIds?: string[]
  transport?: Transport
  push?: PushTransport
}

export async function runMessageJobs(db: PrismaClient, now: Date = new Date(), options: RunOptions = {}): Promise<GymMessageRun[]> {
  const force = new Set(options.force ?? [])
  const gyms = await db.gym.findMany({
    where: { subscriptionStatus: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] }, ...(options.gymIds ? { id: { in: options.gymIds } } : {}) },
    select: { id: true, name: true, slug: true, settings: true },
    orderBy: { createdAt: 'asc' },
  })
  const { hour } = istParts(now)
  const quiet = isQuietHour(now)
  const date = istDateOnly(now).toISOString().slice(0, 10)
  const results: GymMessageRun[] = []

  for (const gym of gyms) {
    const run: GymMessageRun = { gymId: gym.id }
    try {
      const settings = parseGymSettings(gym.settings)
      const messaging = settings.messaging
      const features = await featuresFor(db, gym.id)
      const has = (key: FeatureKey) => features.includes(key)
      const ctx = await loadMessagingContext(db, gym.id, options.transport, options.push)
      const info = { id: gym.id, name: gym.name, slug: gym.slug, messaging }

      const dailyTime = !quiet && hour >= messaging.sendHour
      if (has('dues_reminders') && messaging.duesAuto && (dailyTime || force.has('dues'))) {
        run.dues = await once(db, `dues:${gym.id}:${date}`, force.has('dues'), () => runDueReminders(db, ctx, info, now))
      }
      if (has('dues_reminders') && messaging.renewalReminders && (dailyTime || force.has('renewals'))) {
        run.renewals = await once(db, `renewals:${gym.id}:${date}`, force.has('renewals'), () => runRenewalReminders(db, ctx, info, now))
      }
      if (has('birthday_wishes') && (messaging.birthdayWishes || messaging.anniversaryWishes) && ((!quiet && hour >= 9) || force.has('wishes'))) {
        run.wishes = await once(db, `wishes:${gym.id}:${date}`, force.has('wishes'), () => runWishes(db, ctx, info, now))
      }
      const week = reportWeekFor(now)
      if (has('weekly_report_card') && messaging.weeklyReport && (week || force.has('weekly'))) {
        const weekStart = week ?? reportWeekFor(lastSundayEvening(now)) ?? istDateOnly(now)
        run.weekly = await once(db, `weekly:${gym.id}:${weekStart.toISOString().slice(0, 10)}`, force.has('weekly'), () => runWeeklyReports(db, ctx, info, weekStart, now))
      }
      if (has('slot_booking') && messaging.slotReminders && !quiet) {
        run.slots = await runSlotReminders(db, ctx, info, now)
      }
    } catch (error) {
      console.error('[cron:messages] gym failed', gym.id, error)
      run.error = error instanceof Error ? error.message : 'failed'
    }
    results.push(run)
  }
  return results
}

// For a forced weekly run on any day: the most recent Sunday 7 PM IST.
function lastSundayEvening(now: Date): Date {
  const { weekday } = istParts(now)
  const sunday = new Date(istDateOnly(now).getTime() - weekday * 86400000)
  return new Date(sunday.getTime() + (19 - 5.5) * 3600000)
}

export async function runMotivationJobs(db: PrismaClient, now: Date = new Date(), generate?: LineGenerator): Promise<{ gymId: string; summary?: MotivationSummary; error?: string }[]> {
  const gyms = await db.gym.findMany({ where: { subscriptionStatus: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } }, select: { id: true, name: true, settings: true } })
  const date = istDateOnly(now).toISOString().slice(0, 10)
  const results: { gymId: string; summary?: MotivationSummary; error?: string }[] = []
  for (const gym of gyms) {
    if (!parseGymSettings(gym.settings).messaging.dailyMotivation) continue
    try {
      const summary = await once(db, `motivation:${gym.id}:${date}`, false, () => generateMotivationForGym(db, gym, now, generate))
      results.push({ gymId: gym.id, summary })
    } catch (error) {
      results.push({ gymId: gym.id, error: error instanceof Error ? error.message : 'failed' })
    }
  }
  return results
}
