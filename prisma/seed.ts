import 'dotenv/config'
import { createPrismaClient } from '../lib/db/factory'
import { hashPassword } from '../lib/auth/password'
import { encrypt } from '../lib/crypto'
import { generateTotpSecret, totpUri } from '../lib/auth/totp'
import { SYSTEM_ROLES } from '../lib/auth/permissions'
import { ELITE_FEATURES, PRO_FEATURES, SOLO_FEATURES } from '../lib/features'
import { purgeGymData } from '../lib/platform/purge'
import { computeAttendanceStatus, computeStreak } from '../lib/attendance/status'
import { IST_OFFSET_MS, istDateOnly, istParts, istStartOfDay } from '../lib/time'
import type { Prisma } from '../lib/generated/prisma/client'
import { addMonthsUtc, RETENTION_DAYS, SUSPEND_AFTER_DAYS, TRIAL_DAYS } from '../lib/platform/billing'
import { formatInvoiceNumber } from '../lib/gst'
import { newDeviceKey } from '../lib/attendance/devices'
import { runAttendanceJobsForGym } from '../lib/attendance/jobs'
import { renderTemplate, firstName, waText, type TemplateName } from '../lib/messaging/templates'
import { generateMotivationForGym } from '../lib/messaging/motivation'
import { monthKey as messagingMonthKey } from '../lib/messaging/policy'
import { payLinkUrl } from '../lib/messaging/pay-link'
import { evaluateAthlete } from '../lib/athlete/badges'
import { scopeToGym } from '../lib/db/tenant-core'
import { computeWeeklyRisk } from '../lib/owner/risk'

// ---------------------------------------------------------------------------
// Rep+ demo seed
//   - platform plans (Solo / Pro / Elite) and badge rules
//   - super admin from ADMIN_SEED_* env vars (TOTP secret printed once)
//   - Forge Fitness, Mohali  (owner handles front desk, Pro, 1 branch)
//   - Iron Temple, Zirakpur  (separate desk staff, Elite trial, 2 branches)
//   - realistic athletes, 60 days of attendance, payments + GST invoices,
//     dues, leads, slots, workout splits, challenges, announcements
// Safe to re-run: the two demo gyms are wiped and rebuilt every time.
// ---------------------------------------------------------------------------

const db = createPrismaClient()
const DAY = 24 * 3600 * 1000
const NOW = new Date()
const TODAY = istStartOfDay(NOW)
const DEMO_PASSWORD = 'Rep+@123'

// Deterministic randomness so every seed looks the same.
let rngState = 20261109
function rand(): number {
  rngState |= 0
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]
const chance = (p: number) => rand() < p

// UTC instant for an IST wall-clock time `daysAgo` days before today.
function istAt(daysAgo: number, hour: number, minute = 0): Date {
  return new Date(TODAY.getTime() - daysAgo * DAY + hour * 3600 * 1000 + minute * 60 * 1000)
}
function dateOnlyDaysFromToday(days: number): Date {
  return istDateOnly(new Date(NOW.getTime() + days * DAY))
}
function dayKey(date: Date): string {
  const p = istParts(date)
  return `${p.year}-${p.month + 1}-${p.day}`
}
function weekdayOf(date: Date): number {
  return istParts(date).weekday
}
function financialYear(date: Date): string {
  const p = istParts(date)
  const start = p.month >= 3 ? p.year : p.year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

const FIRST_NAMES_M = ['Arjun', 'Rohit', 'Harpreet', 'Gurjot', 'Aman', 'Karan', 'Vikram', 'Rahul', 'Manpreet', 'Jaskaran', 'Ankit', 'Sahil', 'Deepak', 'Varun', 'Navdeep', 'Rajveer', 'Ishaan', 'Kunal', 'Parth', 'Tejinder', 'Yuvraj', 'Akash', 'Nikhil', 'Hardik']
const FIRST_NAMES_F = ['Simran', 'Nisha', 'Priya', 'Harleen', 'Jasleen', 'Ananya', 'Kavya', 'Neha', 'Ritika', 'Mehak', 'Pooja', 'Sakshi', 'Gurleen', 'Divya', 'Tanvi', 'Aditi', 'Noor', 'Isha']
const LAST_NAMES = ['Sharma', 'Kaur', 'Singh', 'Mehta', 'Verma', 'Gill', 'Sandhu', 'Bansal', 'Arora', 'Malhotra', 'Grewal', 'Dhillon', 'Chopra', 'Kapoor', 'Sidhu', 'Bajwa', 'Gupta', 'Saini', 'Jindal', 'Bhatia']

type Persona = 'regular' | 'casual' | 'slipping' | 'inactive' | 'new' | 'expired'

interface GymSpec {
  slug: string
  name: string
  city: string
  address: string
  gstNumber: string
  ownerHandlesDesk: boolean
  planCode: 'solo' | 'pro' | 'elite'
  status: 'TRIAL' | 'ACTIVE'
  invoicePrefix: string
  athleteCount: number
  owner: { name: string; phone: string; email: string }
  desk: { name: string; phone: string }[]
  trainers: { name: string; phone: string; commissionPct: number }[]
  branches: { name: string; address: string; lat: number; lng: number; capacity: number }[]
  demoAthlete: { name: string; phone: string; language: 'EN' | 'HI' | 'PA' }
  // More members with fixed numbers, so they can log in to the member app.
  extraAthletes?: { name: string; phone: string; language: 'EN' | 'HI' | 'PA' }[]
  // The owner also trains members (gets a roster like a trainer).
  ownerTrains?: boolean
  attendance?: { deskQr: boolean; selfCheckin: boolean; biometric: boolean; manual: boolean }
  phoneBase: number
}

const GYMS: GymSpec[] = [
  {
    // Showcase gym for the first pitch. Owner runs reception and trains too.
    slug: 'sharp-fitness',
    name: 'The Sharp Fitness',
    city: 'Mohali',
    address: 'Shivalik City, Sector 127, Kharar, Mohali, Punjab 140301',
    gstNumber: '03AAKFT4821M1Z6',
    ownerHandlesDesk: true,
    planCode: 'elite',
    status: 'ACTIVE',
    invoicePrefix: 'TSF',
    athleteCount: 112,
    owner: { name: 'Jagtar Singh', phone: '+919876530000', email: 'jagtar@thesharpfitness.in' },
    desk: [],
    trainers: [
      { name: 'Inder', phone: '+919876530011', commissionPct: 40 },
      { name: 'Lakshay', phone: '+919876530012', commissionPct: 35 },
      { name: 'Daniel', phone: '+919876530013', commissionPct: 35 },
    ],
    branches: [{ name: 'Shivalik City', address: 'Shivalik City, Sector 127, Kharar', lat: 30.7356, lng: 76.655, capacity: 60 }],
    demoAthlete: { name: 'Manmeet Singh', phone: '+919876531001', language: 'EN' },
    extraAthletes: [{ name: 'Surajdeep', phone: '+919876531002', language: 'PA' }],
    ownerTrains: true,
    attendance: { deskQr: true, selfCheckin: true, biometric: true, manual: true },
    phoneBase: 9817000000,
  },
  {
    slug: 'forge-fitness',
    name: 'Forge Fitness',
    city: 'Mohali',
    address: 'SCO 42, Phase 7, Sector 61, Mohali, Punjab 160062',
    gstNumber: '03ABCDE1234F1Z5',
    ownerHandlesDesk: true,
    planCode: 'pro',
    status: 'ACTIVE',
    invoicePrefix: 'FF',
    athleteCount: 84,
    owner: { name: 'Gurpreet Singh', phone: '+919876500001', email: 'gurpreet@forgefitness.in' },
    desk: [],
    trainers: [
      { name: 'Harjot Sandhu', phone: '+919876500011', commissionPct: 40 },
      { name: 'Neha Arora', phone: '+919876500012', commissionPct: 35 },
    ],
    branches: [{ name: 'Phase 7', address: 'SCO 42, Phase 7, Mohali', lat: 30.7046, lng: 76.7179, capacity: 45 }],
    demoAthlete: { name: 'Arjun Mehta', phone: '+919876511111', language: 'EN' },
    phoneBase: 9815000000,
  },
  {
    slug: 'iron-temple',
    name: 'Iron Temple',
    city: 'Zirakpur',
    address: 'Plot 7, VIP Road, Zirakpur, Punjab 140603',
    gstNumber: '03FGHIJ5678K1Z2',
    ownerHandlesDesk: false,
    planCode: 'elite',
    status: 'TRIAL',
    invoicePrefix: 'IT',
    athleteCount: 58,
    owner: { name: 'Rajesh Kumar', phone: '+919876500002', email: 'rajesh@irontemple.in' },
    desk: [{ name: 'Pooja Saini', phone: '+919876500003' }],
    trainers: [
      { name: 'Vikram Gill', phone: '+919876500021', commissionPct: 40 },
      { name: 'Aman Dhillon', phone: '+919876500022', commissionPct: 30 },
    ],
    branches: [
      { name: 'VIP Road', address: 'Plot 7, VIP Road, Zirakpur', lat: 30.6425, lng: 76.8173, capacity: 40 },
      { name: 'Patiala Road', address: 'SCO 15, Patiala Road, Zirakpur', lat: 30.6476, lng: 76.8065, capacity: 30 },
    ],
    demoAthlete: { name: 'Simran Kaur', phone: '+919876522222', language: 'PA' },
    phoneBase: 9878000000,
  },
]

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

async function seedPlatform() {
  const plans = [
    { code: 'solo', name: 'Solo', description: 'For single-owner gyms that run the front desk themselves.', monthlyPricePaise: 79900, memberLimit: 150, branchLimit: 1, staffLimit: 1, trainerLimit: 1, deskLimit: 1, whatsappQuota: 500, features: SOLO_FEATURES, isPopular: false, sortOrder: 1, extraBranchPaise: null },
    { code: 'pro', name: 'Pro', description: 'Everything a growing gym needs: trainers, crowd meter, at-risk list and CRM.', monthlyPricePaise: 149900, memberLimit: 500, branchLimit: 1, staffLimit: 7, trainerLimit: 5, deskLimit: 2, whatsappQuota: 2000, features: PRO_FEATURES, isPopular: true, sortOrder: 2, extraBranchPaise: null },
    { code: 'elite', name: 'Elite', description: 'Multi-branch gyms with AI insights, branding and unlimited staff.', monthlyPricePaise: 299900, memberLimit: null, branchLimit: 3, staffLimit: null, trainerLimit: null, deskLimit: null, whatsappQuota: 5000, features: ELITE_FEATURES, isPopular: false, sortOrder: 3, extraBranchPaise: 79900 },
  ]
  for (const plan of plans) {
    const data = { ...plan, annualPricePaise: plan.monthlyPricePaise * 10, features: [...plan.features] }
    await db.platformPlan.upsert({ where: { code: plan.code }, create: data, update: data })
  }

  const badges = [
    { key: 'first_step', name: 'First Step', description: 'Your first check-in', icon: 'footprints', metric: 'total_visits', threshold: 1 },
    { key: 'week_warrior', name: 'Week Warrior', description: '7 day streak', icon: 'flame', metric: 'streak', threshold: 7 },
    { key: 'unstoppable', name: 'Unstoppable', description: '30 day streak', icon: 'zap', metric: 'streak', threshold: 30 },
    { key: 'half_century', name: 'Half Century', description: '50 total visits', icon: 'medal', metric: 'total_visits', threshold: 50 },
    { key: 'early_bird', name: 'Early Bird', description: '10 check-ins before 7 AM', icon: 'sunrise', metric: 'visits_before_7am', threshold: 10 },
    { key: 'regular', name: 'Regular', description: '12 workouts in one month', icon: 'calendar-check', metric: 'visits_this_month', threshold: 12 },
    { key: 'century', name: 'Century', description: '100 total visits', icon: 'trophy', metric: 'total_visits', threshold: 100 },
    { key: 'record_breaker', name: 'Record Breaker', description: 'Logged a personal record', icon: 'dumbbell', metric: 'records', threshold: 1 },
    // Only given by finishing a challenge (no metric reaches it on its own).
    { key: 'challenge_champ', name: 'Challenge Champ', description: 'Finished a gym challenge', icon: 'crown', metric: 'challenge', threshold: 1 },
  ]
  for (const badge of badges) await db.badgeRule.upsert({ where: { key: badge.key }, create: badge, update: badge })
}

async function seedAdmin() {
  const adminId = process.env.ADMIN_SEED_ID
  const password = process.env.ADMIN_SEED_PASSWORD
  if (!adminId || !password) {
    console.warn('! ADMIN_SEED_ID / ADMIN_SEED_PASSWORD not set - skipping super admin')
    return
  }
  if (password.length < 12) throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters')
  const existing = await db.adminUser.findUnique({ where: { adminId } })
  const secretFromEnv = process.env.ADMIN_SEED_TOTP_SECRET?.trim()
  const needsNewSecret = !secretFromEnv && !existing?.totpSecretEnc
  const secret = secretFromEnv || (needsNewSecret ? generateTotpSecret() : null)
  const name = process.env.ADMIN_SEED_NAME ?? 'Rep+ Admin'
  const passwordHash = await hashPassword(password)
  if (existing) {
    await db.adminUser.update({
      where: { adminId },
      data: { name, passwordHash, ...(secret ? { totpSecretEnc: encrypt(secret), totpEnabled: true, lastTotpStep: null } : {}) },
    })
  } else {
    await db.adminUser.create({ data: { adminId, name, passwordHash, totpSecretEnc: encrypt(secret as string), totpEnabled: true } })
  }
  console.info(`+ super admin "${adminId}" ready`)
  if (secret && !secretFromEnv) {
    console.info('  New TOTP secret generated. Add it to your authenticator app NOW (shown only once):')
    console.info(`  secret: ${secret}`)
    console.info(`  uri:    ${totpUri(secret, adminId)}`)
    console.info('  Tip: put it in ADMIN_SEED_TOTP_SECRET so re-seeding keeps the same secret.')
  }
}

// ---------------------------------------------------------------------------
// Rep+ subscriptions (platform billing history)
// ---------------------------------------------------------------------------

let invoiceSeq = new Map<string, number>()

type SubState = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED'

interface SubPlan {
  id: string
  monthlyPricePaise: number
  annualPricePaise: number
}

// Builds the subscription row, its paid invoices and keeps Gym.subscriptionStatus in sync.
// dueDaysAgo: for unpaid states, how long ago the unpaid due date was.
async function seedSubscription(gymId: string, plan: SubPlan, opts: { status: SubState; createdDaysAgo: number; cycle: 'MONTHLY' | 'ANNUAL'; dueDaysAgo?: number }) {
  const created = new Date(NOW.getTime() - opts.createdDaysAgo * DAY)
  await db.gym.update({ where: { id: gymId }, data: { createdAt: created, subscriptionStatus: opts.status } })
  const trialEndsAt = new Date(created.getTime() + TRIAL_DAYS * DAY)
  const months = opts.cycle === 'ANNUAL' ? 12 : 1
  const unpaid = opts.status === 'PAST_DUE' || opts.status === 'READ_ONLY' || opts.status === 'SUSPENDED' || opts.status === 'CANCELLED'
  const stopAt = unpaid ? new Date(NOW.getTime() - (opts.dueDaysAgo ?? 0) * DAY) : NOW

  const periods: { start: Date; end: Date }[] = []
  if (opts.status === 'ACTIVE') {
    let start = trialEndsAt
    while (start.getTime() <= NOW.getTime()) {
      const end = addMonthsUtc(start, months)
      periods.push({ start, end })
      start = end
    }
  } else if (unpaid) {
    // Walk back from the unpaid due date so it lands exactly dueDaysAgo.
    let end = stopAt
    while (true) {
      const start = addMonthsUtc(end, -months)
      if (start.getTime() < trialEndsAt.getTime() - 2 * DAY) break
      periods.unshift({ start, end })
      end = start
    }
  }
  const last = periods.at(-1)
  const dueAt = unpaid ? stopAt : opts.status === 'TRIAL' ? trialEndsAt : (last?.end ?? trialEndsAt)
  const suspendedAt = opts.status === 'SUSPENDED' ? new Date(dueAt.getTime() + SUSPEND_AFTER_DAYS * DAY) : opts.status === 'CANCELLED' ? dueAt : null

  const sub = await db.gymSubscription.create({
    data: {
      gymId,
      planId: plan.id,
      cycle: opts.cycle,
      status: opts.status,
      trialEndsAt,
      currentPeriodStart: last?.start ?? null,
      currentPeriodEnd: last?.end ?? null,
      nextDueAt: dueAt,
      pastDueSince: unpaid && opts.status !== 'CANCELLED' ? dueAt : null,
      suspendedAt,
      dataPurgeAfter: suspendedAt ? new Date(suspendedAt.getTime() + RETENTION_DAYS * DAY) : null,
      lastReminderAt: unpaid ? new Date(NOW.getTime() - 22 * 3600 * 1000) : null,
      statusReason: opts.status === 'CANCELLED' ? 'owner closed the gym' : null,
      manualOverride: opts.status === 'CANCELLED',
    },
  })
  await db.gymOverride.upsert({ where: { gymId }, create: { gymId }, update: {} })
  const amount = opts.cycle === 'ANNUAL' ? plan.annualPricePaise : plan.monthlyPricePaise
  for (const period of periods) {
    const fy = financialYear(period.start)
    // Continue after any invoices already in the database (real or earlier seeds).
    if (!invoiceSeq.has(fy)) invoiceSeq.set(fy, (await db.platformCounter.findUnique({ where: { key: `invoice:${fy}` } }))?.value ?? 0)
    const seq = (invoiceSeq.get(fy) ?? 0) + 1
    invoiceSeq.set(fy, seq)
    const paidAt = new Date(period.start.getTime() + int(0, 2) * DAY)
    await db.platformInvoice.create({
      data: {
        subscriptionId: sub.id,
        number: `RP/${fy}/${String(seq).padStart(5, '0')}`,
        amountPaise: amount,
        gstPaise: Math.round((amount * 18) / 100),
        status: 'PAID',
        periodStart: period.start,
        periodEnd: period.end,
        dueAt: period.start,
        paidAt: paidAt.getTime() > NOW.getTime() ? NOW : paidAt,
        razorpayPaymentId: `pay_seed${gymId.slice(-6)}${seq}${fy.replace('-', '')}`,
      },
    })
  }
  return sub
}

// Extra gyms that only exist on the platform side (owner + members, no
// attendance) so the admin dashboard shows every billing state.
const PLATFORM_GYMS: { name: string; city: string; plan: 'solo' | 'pro' | 'elite'; status: SubState; createdDaysAgo: number; cycle?: 'MONTHLY' | 'ANNUAL'; dueDaysAgo?: number; members: number; owner: string; whatsapp: number }[] = [
  { name: 'Pulse Gym', city: 'Chandigarh', plan: 'pro', status: 'ACTIVE', createdDaysAgo: 310, members: 286, owner: 'Amrit Pal', whatsapp: 1240 },
  { name: 'Body Garage', city: 'Panchkula', plan: 'solo', status: 'ACTIVE', createdDaysAgo: 250, members: 118, owner: 'Sandeep Rana', whatsapp: 430 },
  { name: 'Muscle Factory', city: 'Kharar', plan: 'elite', status: 'ACTIVE', createdDaysAgo: 205, cycle: 'ANNUAL', members: 640, owner: 'Kuldeep Bhullar', whatsapp: 3920 },
  { name: 'Fit Nation', city: 'Chandigarh', plan: 'pro', status: 'ACTIVE', createdDaysAgo: 150, members: 352, owner: 'Rohini Mittal', whatsapp: 1710 },
  { name: 'Core Studio', city: 'Zirakpur', plan: 'solo', status: 'ACTIVE', createdDaysAgo: 88, members: 74, owner: 'Ishita Bedi', whatsapp: 210 },
  { name: 'Shakti Fitness', city: 'Mohali', plan: 'pro', status: 'TRIAL', createdDaysAgo: 11, members: 41, owner: 'Balwinder Kaur', whatsapp: 95 },
  { name: 'Royal Gym', city: 'Panchkula', plan: 'solo', status: 'TRIAL', createdDaysAgo: 4, members: 12, owner: 'Mohit Garg', whatsapp: 18 },
  { name: 'Beast Mode', city: 'Kharar', plan: 'pro', status: 'PAST_DUE', createdDaysAgo: 120, dueDaysAgo: 2, members: 205, owner: 'Gagandeep Sidhu', whatsapp: 980 },
  { name: 'Gold Fitness', city: 'Derabassi', plan: 'solo', status: 'READ_ONLY', createdDaysAgo: 140, dueDaysAgo: 6, members: 96, owner: 'Ravi Thakur', whatsapp: 300 },
  { name: 'Titan Gym', city: 'Mohali', plan: 'solo', status: 'SUSPENDED', createdDaysAgo: 175, dueDaysAgo: 21, members: 63, owner: 'Hardeep Chahal', whatsapp: 0 },
  { name: 'Zen Yoga Studio', city: 'Chandigarh', plan: 'solo', status: 'CANCELLED', createdDaysAgo: 230, dueDaysAgo: 35, members: 48, owner: 'Meenakshi Sood', whatsapp: 0 },
]

async function seedPlatformGyms() {
  const plans = new Map((await db.platformPlan.findMany()).map((plan) => [plan.code, plan]))
  for (const [index, spec] of PLATFORM_GYMS.entries()) {
    const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + spec.city.toLowerCase()
    const old = await db.gym.findUnique({ where: { slug } })
    if (old) await purgeGymData(db, old.id)
    const phone = `+9198770${String(10000 + index * 37).padStart(5, '0')}`
    const gym = await db.gym.create({ data: { slug, name: spec.name, city: spec.city, phone, ownerHandlesDesk: spec.plan === 'solo' } })
    const branch = await db.branch.create({ data: { gymId: gym.id, name: 'Main', isPrimary: true, entranceQrSecret: `${slug}-${index}`, hourlyCapacity: 40 } })
    const role = await db.role.create({ data: { gymId: gym.id, key: 'OWNER', name: 'Owner', permissions: SYSTEM_ROLES.OWNER.permissions, isSystem: true } })
    await db.role.createMany({
      data: [
        { gymId: gym.id, key: 'DESK', name: 'Front desk', permissions: SYSTEM_ROLES.DESK.permissions, isSystem: true },
        { gymId: gym.id, key: 'TRAINER', name: 'Trainer', permissions: SYSTEM_ROLES.TRAINER.permissions, isSystem: true },
      ],
    })
    await db.gymUser.create({ data: { gymId: gym.id, roleId: role.id, kind: 'OWNER', name: spec.owner, phone, branchId: branch.id, lastLoginAt: spec.status === 'CANCELLED' ? null : new Date(NOW.getTime() - int(0, 3) * DAY) } })
    const plan = plans.get(spec.plan)
    if (!plan) throw new Error(`plan ${spec.plan} missing`)
    await seedSubscription(gym.id, plan, { status: spec.status, createdDaysAgo: spec.createdDaysAgo, cycle: spec.cycle ?? 'MONTHLY', dueDaysAgo: spec.dueDaysAgo })
    const members: Prisma.AthleteCreateManyInput[] = Array.from({ length: spec.members }, (_, i) => ({
      gymId: gym.id,
      homeBranchId: branch.id,
      memberCode: `M${1001 + i}`,
      name: `${pick(chance(0.5) ? FIRST_NAMES_M : FIRST_NAMES_F)} ${pick(LAST_NAMES)}`,
      phone: `+91${9600000000 + index * 100000 + i}`,
      referralCode: `R${index}X${1001 + i}`,
      joinedAt: new Date(NOW.getTime() - int(1, spec.createdDaysAgo) * DAY),
      status: 'REGULAR',
    }))
    await db.athlete.createMany({ data: members })
    if (spec.whatsapp > 0) await db.whatsAppUsage.create({ data: { gymId: gym.id, month: monthKey(NOW), sent: spec.whatsapp, warned80: spec.whatsapp >= plan.whatsappQuota * 0.8 } })
  }
  const beast = await db.gym.findFirst({ where: { name: 'Beast Mode' }, include: { staff: { where: { kind: 'OWNER' }, take: 1 } } })
  if (beast) {
    await db.platformPaymentClaim.create({ data: { gymId: beast.id, amountPaise: 176882, method: 'UPI', reference: '431298765012', note: 'Paid from owner PhonePe', submittedBy: beast.staff[0]?.id ?? 'seed' } })
  }
  console.info(`+ ${PLATFORM_GYMS.length} platform demo gyms in every billing state (1 payment claim waiting)`)
}

function monthKey(date: Date): string {
  const p = istParts(date)
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// One gym
// ---------------------------------------------------------------------------

async function seedGym(spec: GymSpec) {
  const old = await db.gym.findUnique({ where: { slug: spec.slug } })
  if (old) await purgeGymData(db, old.id)

  const plan = await db.platformPlan.findUniqueOrThrow({ where: { code: spec.planCode } })
  const gym = await db.gym.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      city: spec.city,
      address: spec.address,
      gstNumber: spec.gstNumber,
      phone: spec.owner.phone,
      email: spec.owner.email,
      subscriptionStatus: spec.status,
      ownerHandlesDesk: spec.ownerHandlesDesk,
      settings: {
        thresholds: { regularVisitsPerWeek: 3, slippingAfterDays: 5, inactiveAfterDays: 15 },
        features: { leaderboard: true, challenges: true, progressPhotos: true },
        renewEarlyDiscountPct: 5,
        referralRewardDays: 7,
        invoicePrefix: spec.invoicePrefix,
        memberUpiId: `${spec.slug.replace(/-/g, '')}@okhdfcbank`,
        // Forge: phones + QR (desk scan and self check-in). Iron Temple: biometric machine + register.
        attendance: spec.attendance
          ? { ...spec.attendance, selfRequireEntranceQr: true, selfRequireLocation: true, manualAllowWithoutPlan: true }
          : spec.planCode === 'elite'
          ? { deskQr: false, selfCheckin: false, biometric: true, manual: true, selfRequireEntranceQr: true, selfRequireLocation: true, manualAllowWithoutPlan: true }
          : { deskQr: true, selfCheckin: true, biometric: false, manual: true, selfRequireEntranceQr: true, selfRequireLocation: true, manualAllowWithoutPlan: true },
      },
    },
  })

  // Rep+ subscription with a realistic payment history
  await seedSubscription(gym.id, plan, spec.status === 'ACTIVE' ? { status: 'ACTIVE', createdDaysAgo: 220, cycle: 'MONTHLY' } : { status: 'TRIAL', createdDaysAgo: 5, cycle: 'MONTHLY' })

  // Branches
  const branches = []
  for (const [index, branch] of spec.branches.entries()) {
    branches.push(
      await db.branch.create({
        data: {
          gymId: gym.id,
          name: branch.name,
          address: branch.address,
          latitude: branch.lat,
          longitude: branch.lng,
          hourlyCapacity: branch.capacity,
          isPrimary: index === 0,
          entranceQrSecret: `${spec.slug}-${index}-${Math.floor(rand() * 1e12).toString(36)}`,
          openingHours: { mon: ['05:30', '22:00'], tue: ['05:30', '22:00'], wed: ['05:30', '22:00'], thu: ['05:30', '22:00'], fri: ['05:30', '22:00'], sat: ['06:00', '21:00'], sun: ['07:00', '12:00'] },
        },
      }),
    )
  }

  // Roles and staff
  const roles: Record<string, string> = {}
  for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
    const created = await db.role.create({ data: { gymId: gym.id, key, name: role.name, permissions: role.permissions, isSystem: true } })
    roles[key] = created.id
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const owner = await db.gymUser.create({
    data: { gymId: gym.id, roleId: roles.OWNER, kind: 'OWNER', name: spec.owner.name, phone: spec.owner.phone, email: spec.owner.email, passwordHash, branchId: branches[0].id },
  })
  for (const desk of spec.desk) {
    await db.gymUser.create({ data: { gymId: gym.id, roleId: roles.DESK, kind: 'DESK', name: desk.name, phone: desk.phone, branchId: branches[0].id } })
  }
  const trainers = []
  for (const [index, trainer] of spec.trainers.entries()) {
    trainers.push(
      await db.gymUser.create({
        data: {
          gymId: gym.id,
          roleId: roles.TRAINER,
          kind: 'TRAINER',
          name: trainer.name,
          phone: trainer.phone,
          commissionPct: trainer.commissionPct,
          ptSessionFeePaise: index === 0 ? 60000 : 50000,
          branchId: branches[index % branches.length].id,
          // Fine-grained example: the first trainer may also collect payments.
          grants: index === 0 ? ['payments.collect', 'payments.read'] : [],
        },
      }),
    )
  }

  // Membership plans
  const planDefs = [
    { name: 'Monthly', durationDays: 30, pricePaise: 150000, joiningFeePaise: 50000, maxFreezeDays: 0, crossBranch: false, sortOrder: 1 },
    { name: 'Quarterly', durationDays: 90, pricePaise: 400000, joiningFeePaise: 50000, maxFreezeDays: 7, crossBranch: false, sortOrder: 2 },
    { name: 'Half yearly', durationDays: 180, pricePaise: 700000, joiningFeePaise: 0, maxFreezeDays: 15, crossBranch: false, sortOrder: 3 },
    { name: 'Gold annual', durationDays: 365, pricePaise: 1200000, joiningFeePaise: 0, maxFreezeDays: 30, crossBranch: spec.branches.length > 1, sortOrder: 4, ptAddonPaise: 600000 },
  ]
  const membershipPlans = []
  for (const def of planDefs) membershipPlans.push(await db.membershipPlan.create({ data: { gymId: gym.id, gstPercent: 18, gstInclusive: true, ...def } }))

  // Reminder stages (owner can edit later)
  await db.reminderStage.createMany({
    data: [
      { gymId: gym.id, stage: 1, name: 'Soft reminder', offsetDays: -3, template: 'kasrat_due_soft' },
      { gymId: gym.id, stage: 2, name: 'Friendly reminder', offsetDays: 0, template: 'kasrat_due_today' },
      { gymId: gym.id, stage: 3, name: 'Gentle follow-up', offsetDays: 3, template: 'kasrat_due_followup' },
      { gymId: gym.id, stage: 4, name: 'Owner alert', offsetDays: 5, template: 'kasrat_due_owner_alert', notifyOwner: true },
    ],
  })

  // -------------------------------------------------------------------------
  // Athletes, memberships, payments, invoices, dues, check-ins
  // -------------------------------------------------------------------------
  const holidayKeys = new Set<string>()
  const counter = new Map<string, number>()
  const nextInvoice = (date: Date) => {
    const fy = financialYear(date)
    const sequence = (counter.get(fy) ?? 0) + 1
    counter.set(fy, sequence)
    return { fy, sequence, number: formatInvoiceNumber(spec.invoicePrefix, fy, sequence) }
  }

  const personas: Persona[] = []
  for (let i = 0; i < spec.athleteCount; i += 1) {
    const roll = rand()
    personas.push(roll < 0.42 ? 'regular' : roll < 0.62 ? 'casual' : roll < 0.74 ? 'slipping' : roll < 0.82 ? 'inactive' : roll < 0.92 ? 'new' : 'expired')
  }
  personas[0] = 'regular'

  const checkIns: Prisma.CheckInCreateManyInput[] = []
  const payments: { athleteId: string; membershipId: string; amountPaise: number; paidAt: Date; method: 'CASH' | 'UPI' | 'RAZORPAY'; planName: string }[] = []
  const dues: Prisma.DueCreateManyInput[] = []
  const bookingsPlan: { athleteId: string; branchId: string; hour: number }[] = []
  const athleteIds: { id: string; persona: Persona; trainerId: string | null; branchId: string; hour: number; name: string }[] = []

  for (let i = 0; i < spec.athleteCount; i += 1) {
    const persona = personas[i]
    const female = chance(0.42)
    const special = [spec.demoAthlete, ...(spec.extraAthletes ?? [])][i]
    const isDemo = i === 0
    const name = special ? special.name : `${pick(female ? FIRST_NAMES_F : FIRST_NAMES_M)} ${pick(LAST_NAMES)}`
    const phone = special ? special.phone : `+91${spec.phoneBase + i * 7 + 13}`
    const language = special ? special.language : chance(0.6) ? 'EN' : chance(0.5) ? 'HI' : 'PA'
    const branch = branches[i % branches.length]
    const pool = spec.ownerTrains ? [owner, ...trainers] : trainers
    const trainer = special || chance(0.55) ? pool[i % pool.length] : null
    const joinedDaysAgo = persona === 'new' ? int(2, 12) : isDemo ? 220 : int(40, 420)
    const joinedAt = istAt(joinedDaysAgo, 10)
    const hour = pick([6, 6, 7, 7, 8, 10, 11, 17, 18, 18, 19, 19, 20])
    const dob = new Date(Date.UTC(int(1985, 2006), int(0, 11), int(1, 28)))

    // Current membership window
    const membershipPlan = isDemo ? membershipPlans[3] : pick(membershipPlans)
    let endsInDays: number
    if (persona === 'expired') endsInDays = -int(3, 25)
    else if (isDemo) endsInDays = 62
    else if (chance(0.14)) endsInDays = int(0, 7)
    else endsInDays = int(8, membershipPlan.durationDays - 1)
    const endsAt = dateOnlyDaysFromToday(endsInDays)
    const startsAt = new Date(endsAt.getTime() - membershipPlan.durationDays * DAY)
    const status = endsInDays < 0 ? 'EXPIRED' : 'ACTIVE'

    const athlete = await db.athlete.create({
      data: {
        gymId: gym.id,
        homeBranchId: branch.id,
        trainerId: trainer?.id ?? null,
        memberCode: `${spec.invoicePrefix}${String(1001 + i)}`,
        name,
        phone,
        gender: female ? 'F' : 'M',
        dateOfBirth: dob,
        joinedAt,
        language,
        referralCode: `${spec.invoicePrefix}${name.split(' ')[0].toUpperCase().slice(0, 5)}${100 + i}`,
        biometricId: spec.planCode === 'elite' ? String(101 + i) : null,
        restDays: [0],
        hideFromLeaderboard: chance(0.08),
      },
    })
    const membership = await db.membership.create({
      data: {
        gymId: gym.id,
        athleteId: athlete.id,
        planId: membershipPlan.id,
        status,
        startsAt,
        endsAt,
        pricePaise: membershipPlan.pricePaise,
        ptSessionsLeft: trainer && chance(0.3) ? int(2, 10) : 0,
      },
    })
    athleteIds.push({ id: athlete.id, persona, trainerId: trainer?.id ?? null, branchId: branch.id, hour, name })

    // Payment for the current membership (if it started within the window we model)
    const paidAt = new Date(Math.max(startsAt.getTime() - IST_OFFSET_MS + 11 * 3600 * 1000, joinedAt.getTime()))
    if (paidAt.getTime() <= NOW.getTime()) {
      payments.push({ athleteId: athlete.id, membershipId: membership.id, amountPaise: membershipPlan.pricePaise, paidAt, method: chance(0.55) ? 'UPI' : chance(0.6) ? 'CASH' : 'RAZORPAY', planName: membershipPlan.name })
    }

    // Renewal dues: expired, or expiring within 7 days
    if (endsInDays <= 7) {
      const overdueDays = -endsInDays
      const stage = overdueDays >= 5 ? 4 : overdueDays >= 3 ? 3 : overdueDays >= 0 ? 2 : endsInDays <= 3 ? 1 : 0
      dues.push({
        gymId: gym.id,
        athleteId: athlete.id,
        membershipId: membership.id,
        amountPaise: membershipPlan.pricePaise,
        dueDate: endsAt,
        status: 'OPEN',
        reminderStage: stage,
        lastRemindedAt: stage > 0 ? new Date(TODAY.getTime() - int(1, 2) * DAY + (10 * 60 + int(0, 20)) * 60000) : null,
      })
    }

    // Attendance for the last 60 days
    const visitProbability = { regular: 0.8, casual: 0.42, slipping: 0.7, inactive: 0.65, new: 0.75, expired: 0.5 }[persona]
    const stopAfter = { regular: 0, casual: 0, slipping: int(5, 13), inactive: int(16, 45), new: 0, expired: Math.max(0, -endsInDays) }[persona]
    const firstDay = Math.min(60, joinedDaysAgo)
    for (let daysAgo = firstDay; daysAgo >= stopAfter; daysAgo -= 1) {
      const instant = istAt(daysAgo, 12)
      if (weekdayOf(instant) === 0 && !chance(0.15)) continue
      if (!chance(visitProbability)) continue
      const h = Math.min(21, Math.max(5, hour + (chance(0.25) ? pick([-1, 1, 2]) : 0)))
      const minute = int(0, 55)
      const checkedInAt = istAt(daysAgo, h, minute)
      if (checkedInAt.getTime() > NOW.getTime()) continue
      const session = int(55, 95) * 60 * 1000
      const outAt = new Date(checkedInAt.getTime() + session)
      const stillInside = outAt.getTime() > NOW.getTime()
      checkIns.push({
        gymId: gym.id,
        branchId: branch.id,
        athleteId: athlete.id,
        method: spec.planCode === 'elite' ? (chance(0.9) ? 'BIOMETRIC' : 'MANUAL') : chance(0.65) ? 'QR_ROTATING' : chance(0.6) ? 'QR_ENTRANCE' : 'MANUAL',
        checkedInAt,
        checkedOutAt: stillInside ? null : outAt,
        autoCheckout: !stillInside && chance(0.4),
      })
    }

    if ((persona === 'regular' || persona === 'new') && chance(0.7)) bookingsPlan.push({ athleteId: athlete.id, branchId: branch.id, hour })
  }

  // Make sure the floor looks alive right now: a few people checked in recently.
  const nowHour = istParts(NOW).hour
  if (nowHour >= 5 && nowHour <= 22) {
    for (const entry of athleteIds.filter((a) => a.persona === 'regular').slice(1, 1 + Math.max(6, Math.round(spec.athleteCount / 7)))) {
      const minutesAgo = int(5, 60)
      checkIns.push({ gymId: gym.id, branchId: entry.branchId, athleteId: entry.id, method: spec.planCode === 'elite' ? 'BIOMETRIC' : 'QR_ROTATING', checkedInAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000) })
    }
  }

  await db.checkIn.createMany({ data: checkIns })
  await db.due.createMany({ data: dues })

  // Payments + GST invoices (18% inclusive, intra-state => CGST + SGST)
  payments.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
  for (const payment of payments) {
    const created = await db.payment.create({
      data: { gymId: gym.id, athleteId: payment.athleteId, membershipId: payment.membershipId, amountPaise: payment.amountPaise, method: payment.method, status: 'PAID', paidAt: payment.paidAt, collectedById: owner.id },
    })
    const taxable = Math.round(payment.amountPaise / 1.18)
    const tax = payment.amountPaise - taxable
    const cgst = Math.floor(tax / 2)
    const invoice = nextInvoice(payment.paidAt)
    await db.invoice.create({
      data: {
        gymId: gym.id,
        athleteId: payment.athleteId,
        paymentId: created.id,
        number: invoice.number,
        financialYear: invoice.fy,
        sequence: invoice.sequence,
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: tax - cgst,
        totalPaise: payment.amountPaise,
        lineItems: [{ description: `${payment.planName} membership`, sac: '999723', amountPaise: payment.amountPaise }],
        issuedAt: payment.paidAt,
      },
    })
  }
  for (const [fy, lastSequence] of counter.entries()) await db.invoiceCounter.create({ data: { gymId: gym.id, financialYear: fy, lastSequence } })

  // Derived athlete fields: last visit, streak, status
  const visitsByAthlete = new Map<string, Date[]>()
  for (const checkIn of checkIns) {
    const list = visitsByAthlete.get(checkIn.athleteId) ?? []
    list.push(new Date(checkIn.checkedInAt as Date))
    visitsByAthlete.set(checkIn.athleteId, list)
  }
  const memberships = await db.membership.findMany({ where: { gymId: gym.id } })
  const activeByAthlete = new Map(memberships.map((m) => [m.athleteId, m.status === 'ACTIVE']))
  const athletesForStatus = await db.athlete.findMany({ where: { gymId: gym.id }, select: { id: true, joinedAt: true, restDays: true } })
  for (const athlete of athletesForStatus) {
    const visits = (visitsByAthlete.get(athlete.id) ?? []).sort((a, b) => a.getTime() - b.getTime())
    const keys = new Set(visits.map(dayKey))
    const lastVisitAt = visits.at(-1) ?? null
    const visitsLast14Days = visits.filter((v) => v.getTime() >= NOW.getTime() - 14 * DAY).length
    const status = computeAttendanceStatus({ now: NOW, joinedAt: athlete.joinedAt, lastVisitAt, visitsLast14Days, hasActiveMembership: activeByAthlete.get(athlete.id) ?? false, isFrozen: false })
    const streak = computeStreak(keys, NOW, athlete.restDays, holidayKeys, dayKey, weekdayOf)
    await db.athlete.update({
      where: { id: athlete.id },
      data: { status, statusComputedAt: NOW, lastVisitAt, streakDays: streak, bestStreak: Math.max(streak, streak + int(0, 9)), lastAppOpenAt: lastVisitAt },
    })
  }

  // Slots for the next 7 days + bookings
  const slotRows: Prisma.SlotCreateManyInput[] = []
  for (const branch of branches) {
    for (let d = 0; d < 7; d += 1) {
      for (let hour = 6; hour <= 21; hour += 1) {
        slotRows.push({ gymId: gym.id, branchId: branch.id, date: dateOnlyDaysFromToday(d), startHour: hour, capacity: branch.hourlyCapacity })
      }
    }
  }
  await db.slot.createMany({ data: slotRows })
  const slots = await db.slot.findMany({ where: { gymId: gym.id } })
  const slotIndex = new Map(slots.map((s) => [`${s.branchId}|${s.date.toISOString()}|${s.startHour}`, s]))
  const bookingRows: Prisma.SlotBookingCreateManyInput[] = []
  const bookedCount = new Map<string, number>()
  for (const plan of bookingsPlan) {
    for (let d = 0; d < 7; d += 1) {
      const date = dateOnlyDaysFromToday(d)
      if (date.getUTCDay() === 0) continue
      const slot = slotIndex.get(`${plan.branchId}|${date.toISOString()}|${plan.hour}`)
      if (!slot || !chance(0.75)) continue
      bookingRows.push({ gymId: gym.id, slotId: slot.id, athleteId: plan.athleteId })
      bookedCount.set(slot.id, (bookedCount.get(slot.id) ?? 0) + 1)
    }
  }
  await db.slotBooking.createMany({ data: bookingRows })
  for (const [slotId, booked] of bookedCount.entries()) await db.slot.update({ where: { id: slotId }, data: { booked } })

  // Workout splits for athletes with a trainer (and the demo athlete)
  const split = (focus: string[]) => ({
    days: [
      { weekday: 1, title: 'Push power', focus: 'Chest, Shoulders, Triceps', minutes: 38, exercises: [{ name: 'Bench press', sets: 4, reps: '8' }, { name: 'Overhead press', sets: 3, reps: '10' }, { name: 'Incline dumbbell press', sets: 3, reps: '12' }, { name: 'Tricep pushdown', sets: 3, reps: '15' }] },
      { weekday: 2, title: 'Pull strength', focus: 'Back, Biceps', minutes: 40, exercises: [{ name: 'Deadlift', sets: 4, reps: '5' }, { name: 'Lat pulldown', sets: 3, reps: '10' }, { name: 'Seated row', sets: 3, reps: '12' }, { name: 'Barbell curl', sets: 3, reps: '12' }] },
      { weekday: 3, title: 'Leg day', focus: 'Quads, Hamstrings, Calves', minutes: 45, exercises: [{ name: 'Back squat', sets: 4, reps: '8' }, { name: 'Romanian deadlift', sets: 3, reps: '10' }, { name: 'Leg press', sets: 3, reps: '12' }, { name: 'Calf raise', sets: 4, reps: '15' }] },
      { weekday: 4, title: 'Push volume', focus: focus[0], minutes: 35, exercises: [{ name: 'Dumbbell press', sets: 4, reps: '12' }, { name: 'Lateral raise', sets: 4, reps: '15' }, { name: 'Dips', sets: 3, reps: '10' }] },
      { weekday: 5, title: 'Pull volume', focus: focus[1], minutes: 35, exercises: [{ name: 'Pull ups', sets: 4, reps: '8' }, { name: 'Face pull', sets: 3, reps: '15' }, { name: 'Hammer curl', sets: 3, reps: '12' }] },
      { weekday: 6, title: 'Conditioning', focus: 'HIIT, Core', minutes: 30, exercises: [{ name: 'Rowing intervals', sets: 6, reps: '1 min' }, { name: 'Plank', sets: 3, reps: '60 s' }, { name: 'Kettlebell swing', sets: 4, reps: '20' }] },
    ],
  })
  const splitRows: Prisma.WorkoutSplitCreateManyInput[] = athleteIds
    .filter((a, index) => a.trainerId || index === 0)
    .map((a) => ({ gymId: gym.id, athleteId: a.id, createdById: a.trainerId, days: split(['Chest, Shoulders', 'Back, Arms']), dietNotes: 'High protein: dal, paneer, eggs or soya at every meal. 3 litres water. Limit fried snacks.' }))
  await db.workoutSplit.createMany({ data: splitRows })

  // Weekly challenge
  const weekStart = istAt(istParts(NOW).weekday === 0 ? 6 : istParts(NOW).weekday - 1, 0)
  const challenge = await db.challenge.create({
    data: { gymId: gym.id, title: 'Earn your edge', description: 'Complete 4 workouts this week to unlock the Challenge Champ badge.', metric: 'visits', target: 4, startsAt: istDateOnly(weekStart), endsAt: istDateOnly(new Date(weekStart.getTime() + 6 * DAY)), badgeKey: 'challenge_champ' },
  })
  const entries: Prisma.ChallengeEntryCreateManyInput[] = []
  for (const a of athleteIds) {
    const progress = (visitsByAthlete.get(a.id) ?? []).filter((v) => v.getTime() >= weekStart.getTime()).length
    if (progress > 0 || a.persona === 'regular') entries.push({ gymId: gym.id, challengeId: challenge.id, athleteId: a.id, progress: Math.min(progress, 4), completedAt: progress >= 4 ? NOW : null })
  }
  await db.challengeEntry.createMany({ data: entries })

  // Leads
  const leadSources = ['WALK_IN', 'INSTAGRAM', 'GOOGLE', 'REFERRAL', 'WEBSITE'] as const
  const leadStages = ['NEW', 'NEW', 'TRIAL', 'FOLLOW_UP', 'FOLLOW_UP', 'JOINED', 'LOST'] as const
  const leads: Prisma.LeadCreateManyInput[] = []
  for (let i = 0; i < 34; i += 1) {
    const stage = pick(leadStages)
    const createdAt = new Date(NOW.getTime() - (i < 16 ? int(0, 25) : int(26, 150)) * DAY)
    const open = stage === 'NEW' || stage === 'TRIAL' || stage === 'FOLLOW_UP'
    leads.push({
      gymId: gym.id,
      branchId: branches[i % branches.length].id,
      name: `${pick(chance(0.5) ? FIRST_NAMES_M : FIRST_NAMES_F)} ${pick(LAST_NAMES)}`,
      phone: `+91${spec.phoneBase + 900000 + i * 11}`,
      source: pick(leadSources),
      stage,
      interest: pick(['Weight loss', 'Muscle gain', 'General fitness', 'Personal training', 'Couple membership']),
      nextFollowUpAt: open ? new Date(NOW.getTime() + int(-2, 4) * DAY) : null,
      assignedToId: owner.id,
      lostReason: stage === 'LOST' ? pick(['Too far', 'Price', 'Joined elsewhere']) : null,
      notes: stage === 'NEW' ? '' : pick(['Called, wants evening batch. Will visit Saturday.', 'Came for trial, liked the trainers. Thinking about 3 months.', 'Asked for couple discount.', 'Busy this week, call again Monday.']),
      lastContactAt: stage === 'NEW' ? null : new Date(createdAt.getTime() + DAY),
      createdAt,
    })
  }
  await db.lead.createMany({ data: leads })

  // Announcements, complaints, expenses
  await db.announcement.createMany({
    data: [
      { gymId: gym.id, title: 'New squat racks are in', body: 'Two new power racks on the main floor. Book a slot and try them out!', pinned: true, createdById: owner.id },
      { gymId: gym.id, title: 'Sunday timings', body: 'On Sundays we are open 7 AM to 12 PM only.', createdById: owner.id },
    ],
  })
  await db.complaint.createMany({
    data: [
      { gymId: gym.id, branchId: branches[0].id, athleteId: athleteIds[3]?.id, kind: 'EQUIPMENT', title: 'Treadmill 3 belt slipping', body: 'Belt slips at speed 8 and above.' },
      { gymId: gym.id, branchId: branches[0].id, athleteId: athleteIds[7]?.id, kind: 'CLEANLINESS', title: 'Washroom needs attention in the evening', body: 'Around 7 PM the washroom is not clean.', status: 'IN_PROGRESS' },
    ],
  })
  const expenseRows: Prisma.ExpenseCreateManyInput[] = []
  for (let m = 0; m < 6; m += 1) {
    const spentOn = dateOnlyDaysFromToday(-(m * 30 + 3))
    expenseRows.push(
      { gymId: gym.id, branchId: branches[0].id, category: 'RENT', amountPaise: spec.branches.length > 1 ? 2200000 : 1500000, spentOn, createdById: owner.id, note: 'Monthly rent' },
      { gymId: gym.id, category: 'SALARY', amountPaise: 1200000, spentOn, createdById: owner.id, note: 'Trainer and staff salaries' },
      { gymId: gym.id, branchId: branches[0].id, category: 'ELECTRICITY', amountPaise: int(420000, 610000), spentOn, createdById: owner.id, note: 'PSPCL bill' },
    )
  }
  await db.expense.createMany({ data: expenseRows })

  // Demo athlete progress
  const demo = athleteIds[0]
  const progressRows: Prisma.ProgressLogCreateManyInput[] = []
  for (let w = 8; w >= 0; w -= 1) progressRows.push({ gymId: gym.id, athleteId: demo.id, loggedOn: dateOnlyDaysFromToday(-w * 7), weightKg: Number((78.4 - (8 - w) * 0.35).toFixed(1)), waistCm: Number((88 - (8 - w) * 0.4).toFixed(1)) })
  await db.progressLog.createMany({ data: progressRows })
  await db.personalRecord.createMany({
    data: [
      { gymId: gym.id, athleteId: demo.id, exercise: 'Bench press', weightKg: 70, reps: 5, achievedOn: dateOnlyDaysFromToday(-12) },
      { gymId: gym.id, athleteId: demo.id, exercise: 'Back squat', weightKg: 95, reps: 5, achievedOn: dateOnlyDaysFromToday(-5) },
      { gymId: gym.id, athleteId: demo.id, exercise: 'Deadlift', weightKg: 120, reps: 3, achievedOn: dateOnlyDaysFromToday(-19) },
    ],
  })

  if (spec.planCode === 'elite') {
    await db.attendanceDevice.create({ data: { gymId: gym.id, branchId: branches[0].id, name: `${branches[0].name} entry (eSSL)`, kind: 'ADMS', vendor: 'eSSL', serialNumber: `ESSL${spec.invoicePrefix}0001`, lastSeenAt: new Date(NOW.getTime() - 4 * 60000), punches: 1200 } })
    const key = newDeviceKey()
    const last = branches[branches.length - 1]
    await db.attendanceDevice.create({ data: { gymId: gym.id, branchId: last.id, name: `${last.name} ${branches.length > 1 ? 'turnstile' : 'biometric API'}`, kind: 'API', vendor: 'Generic', keyPrefix: key.prefix, keyHash: key.hash } })
    console.info(`  demo API device key for ${spec.name} (${last.name}): ${key.raw}`)
  }
  await runAttendanceJobsForGym(db, gym.id, NOW)

  await seedMessages(gym.id, spec, owner)
  await seedAthleteApp(gym.id, spec)
  await seedTrainerDesk(gym.id)
  await seedGrowth(gym.id, spec)

  console.info(`+ ${spec.name}: ${spec.athleteCount} athletes, ${checkIns.length} check-ins, ${payments.length} payments, ${dues.length} dues, ${leads.length} leads, ${bookingRows.length} slot bookings`)
}

// ---------------------------------------------------------------------------
// Phase 5: 5 weeks of WhatsApp history (dues reminders, owner alerts,
// birthdays, weekly report cards, slot reminders, OTPs) with realistic
// delivery receipts; usage for this month matches the log. Also: one member
// who replied STOP, two birthdays today, and today's motivation lines.
// ---------------------------------------------------------------------------
async function seedMessages(gymId: string, spec: GymSpec, owner: { id: string; name: string; phone: string }) {
  const gym = await db.gym.findUniqueOrThrow({ where: { id: gymId }, select: { name: true } })
  const athletes = await db.athlete.findMany({ where: { gymId }, orderBy: { memberCode: 'asc' }, select: { id: true, name: true, phone: true, language: true, memberCode: true, dateOfBirth: true } })
  const byId = new Map(athletes.map((a) => [a.id, a]))
  const rows: Prisma.MessageLogCreateManyInput[] = []
  const startMonth = istStartOfDay(new Date(Date.UTC(istParts(NOW).year, istParts(NOW).month, 1, 12)))
  let n = 0

  const add = (at: Date, template: TemplateName, params: string[], purpose: string, to: { phone: string; language: 'EN' | 'HI' | 'PA'; athleteId?: string; staffId?: string }, dedupeKey: string | null) => {
    if (at.getTime() > NOW.getTime() - 30 * 60000) return
    const roll = rand()
    const status = roll < 0.03 ? 'FAILED' : roll < 0.08 ? 'SENT' : roll < 0.36 ? 'DELIVERED' : 'READ'
    n += 1
    rows.push({
      gymId,
      athleteId: to.athleteId ?? null,
      staffId: to.staffId ?? null,
      channel: 'WHATSAPP',
      template,
      language: to.language,
      purpose,
      dedupeKey: status === 'FAILED' ? null : dedupeKey,
      critical: template === ('kasrat_otp' as TemplateName),
      toPhone: to.phone,
      body: template === ('kasrat_otp' as TemplateName) ? 'Login code' : renderTemplate(template, to.language, params),
      status,
      providerId: `wamid.seed_${gymId}_${n}`,
      error: status === 'FAILED' ? '131026 Message undeliverable' : null,
      sentAt: at,
      deliveredAt: status === 'DELIVERED' || status === 'READ' ? new Date(at.getTime() + 40000) : null,
      readAt: status === 'READ' ? new Date(at.getTime() + int(3, 240) * 60000) : null,
      createdAt: at,
    })
  }
  const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
  const short = (date: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date)
  const at10 = (date: Date, offsetDays: number) => new Date(date.getTime() + offsetDays * DAY + (10 * 60 - 330) * 60000 + int(0, 20) * 60000)
  const notes = { EN: 'Renew on time and keep the momentum going.', HI: 'Renew on time.', PA: 'Renew on time.' }

  // Dues reminders that already went out, matching each due's stage.
  const stages = [
    { stage: 1, offset: -3, template: 'kasrat_due_soft' as const },
    { stage: 2, offset: 0, template: 'kasrat_due_today' as const },
    { stage: 3, offset: 3, template: 'kasrat_due_followup' as const },
  ]
  const dues = await db.due.findMany({ where: { gymId, status: 'OPEN' } })
  for (const due of dues) {
    const a = byId.get(due.athleteId)
    if (!a) continue
    const link = payLinkUrl(due.id)
    if (due.reminderStage > 0) await db.due.update({ where: { id: due.id }, data: { paymentLinkUrl: link } })
    for (const stage of stages.filter((s) => s.stage <= due.reminderStage)) {
      add(at10(due.dueDate, stage.offset), stage.template, [firstName(a.name), gym.name, inr(due.amountPaise), short(due.dueDate), notes.EN, link], 'due_reminder', { phone: a.phone, language: a.language, athleteId: a.id }, `due:${due.id}:s${stage.stage}`)
    }
    if (due.reminderStage >= 4) {
      add(at10(due.dueDate, 5), 'kasrat_due_owner_alert', [firstName(owner.name), a.name, a.memberCode, inr(due.amountPaise), '5', 'https://kasrat.app/owner/payments?tab=dues'], 'due_owner_alert', { phone: owner.phone, language: 'EN', staffId: owner.id }, `due:${due.id}:s4:${owner.id}`)
    }
  }

  // Birthdays in the last 5 weeks.
  for (const a of athletes) {
    if (!a.dateOfBirth) continue
    for (let daysAgo = 1; daysAgo <= 35; daysAgo += 1) {
      const day = new Date(TODAY.getTime() - daysAgo * DAY + 12 * 3600000)
      const p = istParts(day)
      if (a.dateOfBirth.getUTCMonth() === p.month && a.dateOfBirth.getUTCDate() === p.day) {
        add(new Date(TODAY.getTime() - daysAgo * DAY + 9 * 3600000 - 330 * 60000 + 3600000 * 3.5), 'kasrat_birthday', [firstName(a.name), gym.name], 'birthday', { phone: a.phone, language: a.language, athleteId: a.id }, `bday:${a.id}:${p.year}`)
      }
    }
  }

  // Weekly report cards: the last 4 Sundays at about 6 PM, to members with visits.
  const recent = await db.checkIn.groupBy({ by: ['athleteId'], where: { gymId, checkedInAt: { gte: new Date(NOW.getTime() - 35 * DAY) } }, _count: { _all: true } })
  const activeIds = recent.filter((row) => row._count._all >= 3).map((row) => row.athleteId)
  for (let week = 0; week < 4; week += 1) {
    const sinceSunday = istParts(NOW).weekday
    const sunday = new Date(TODAY.getTime() - (sinceSunday + week * 7) * DAY)
    const weekStart = new Date(Date.UTC(istParts(sunday).year, istParts(sunday).month, istParts(sunday).day) - 6 * DAY).toISOString().slice(0, 10)
    for (const id of activeIds) {
      const a = byId.get(id)
      if (!a) continue
      const sentAt = new Date(sunday.getTime() + (18 * 60 + int(0, 25)) * 60000)
      add(sentAt, 'kasrat_weekly_report', [firstName(a.name), String(int(2, 6)), String(int(1, 14)), pick(['6:00 AM', '7:00 AM', '6:00 PM', '7:00 PM']), 'Log your progress in the app to see it here.', gym.name], 'weekly_report', { phone: a.phone, language: a.language, athleteId: a.id }, `weekly:${a.id}:${weekStart}`)
    }
  }

  // Slot reminders and login codes, a few per day.
  for (let daysAgo = 1; daysAgo <= 35; daysAgo += 1) {
    for (let k = 0; k < int(2, 6); k += 1) {
      const a = pick(athletes)
      const hour = pick([10, 11, 17, 18, 19, 20])
      add(new Date(TODAY.getTime() - daysAgo * DAY + (hour - 1) * 3600000), 'kasrat_slot_reminder', [firstName(a.name), waText(a.language, 'todayAt', { time: `${hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? 'AM' : 'PM'}` }), gym.name], 'slot_reminder', { phone: a.phone, language: a.language, athleteId: a.id }, null)
    }
    for (let k = 0; k < int(1, 4); k += 1) {
      const a = pick(athletes)
      add(new Date(TODAY.getTime() - daysAgo * DAY + int(8, 20) * 3600000), 'kasrat_otp' as TemplateName, [], 'otp', { phone: a.phone, language: a.language, athleteId: a.id }, null)
    }
  }

  await db.messageLog.createMany({ data: rows })
  const sentThisMonth = rows.filter((row) => row.status !== 'FAILED' && (row.createdAt as Date).getTime() >= startMonth.getTime()).length
  const plan = await db.gymSubscription.findUnique({ where: { gymId }, select: { plan: { select: { whatsappQuota: true } } } })
  const quota = plan?.plan.whatsappQuota ?? 0
  await db.whatsAppUsage.create({ data: { gymId, month: messagingMonthKey(NOW), sent: sentThisMonth, warned80: quota > 0 && sentThisMonth >= quota * 0.8 } })

  // One member replied STOP; two members have their birthday today.
  const others = athletes.slice(3)
  if (others[2]) await db.athlete.update({ where: { id: others[2].id }, data: { whatsappOptOut: true } })
  const today = istParts(NOW)
  for (const a of others.slice(5, 7)) {
    await db.athlete.update({ where: { id: a.id }, data: { dateOfBirth: new Date(Date.UTC(int(1988, 2004), today.month, today.day)) } })
    await db.messageLog.deleteMany({ where: { gymId, athleteId: a.id, purpose: 'birthday' } })
  }

  const motivation = await generateMotivationForGym(db, { id: gymId, name: gym.name }, NOW, async () => null)
  console.info(`  ${rows.length} WhatsApp log rows (${sentThisMonth} this month), ${motivation.created} motivation lines for today`)
}

// ---------------------------------------------------------------------------
// Phase 6: badges for everyone, a referral that paid out, an "I've paid"
// UPI claim and a freeze request waiting at the desk, a referral lead.
// ---------------------------------------------------------------------------
async function seedAthleteApp(gymId: string, spec: GymSpec) {
  const tdb = scopeToGym(db, gymId)
  const gym = await db.gym.findUniqueOrThrow({ where: { id: gymId }, select: { slug: true } })
  const rules = await db.badgeRule.findMany({ where: { active: true } })
  const athletes = await db.athlete.findMany({ where: { gymId, archived: false }, orderBy: { memberCode: 'asc' }, select: { id: true, name: true, phone: true } })
  let badges = 0
  for (const athlete of athletes) badges += (await evaluateAthlete(tdb, { id: gymId, slug: gym.slug }, athlete.id, rules, NOW, async () => 'ok')).newBadges.length
  // Badge notifications from seeding are old news: mark them read.
  await db.notification.updateMany({ where: { gymId, recipientType: 'ATHLETE' }, data: { readAt: NOW } })

  const demo = athletes[0]
  const friend = athletes[8]
  if (demo && friend) {
    await db.athlete.update({ where: { id: friend.id }, data: { referredById: demo.id } })
    await db.referral.create({ data: { gymId, referrerId: demo.id, referredAthleteId: friend.id, rewardDays: 7, rewardedAt: new Date(NOW.getTime() - 20 * DAY), createdAt: new Date(NOW.getTime() - 20 * DAY) } })
    await db.notification.create({ data: { gymId, recipientType: 'ATHLETE', recipientId: demo.id, title: 'Referral reward!', body: `${friend.name.split(' ')[0]} joined. 7 free days added to your plan.`, href: `/g/${gym.slug}/profile`, createdAt: new Date(NOW.getTime() - 20 * DAY) } })
    await db.lead.create({ data: { gymId, name: 'Karan Gill', phone: `+91981${String(int(1000000, 9999999))}`, source: 'REFERRAL', referrerId: demo.id, interest: 'Free trial', notes: `Referred by ${demo.name}`, nextFollowUpAt: new Date(NOW.getTime() + DAY) } })
  }

  // One "I've paid" claim per open due of the 2nd/3rd member with dues.
  const dues = await db.due.findMany({ where: { gymId, status: 'OPEN' }, orderBy: { dueDate: 'asc' }, take: 2 })
  for (const [index, due] of dues.entries()) {
    await db.memberPaymentClaim.create({ data: { gymId, athleteId: due.athleteId, kind: 'DUE', dueId: due.id, amountPaise: due.amountPaise, utr: `4${String(int(10000000000, 99999999999))}`, note: index === 0 ? 'Paid from my brother\'s PhonePe' : '', createdAt: new Date(NOW.getTime() - (index + 1) * 3 * 3600000) } })
  }

  // A freeze request from a member whose plan has freeze days.
  const plans = await db.membershipPlan.findMany({ where: { gymId, maxFreezeDays: { gt: 0 } }, select: { id: true } })
  const membership = await db.membership.findFirst({ where: { gymId, status: 'ACTIVE', planId: { in: plans.map((p) => p.id) }, endsAt: { gte: new Date(NOW.getTime() + 20 * DAY) }, athleteId: { notIn: [demo?.id ?? ''] } } })
  if (membership) {
    await db.freezeRequest.create({ data: { gymId, athleteId: membership.athleteId, membershipId: membership.id, fromDate: new Date(TODAY.getTime() + 2 * DAY + 330 * 60000), days: 5, reason: 'Going home to Ludhiana for a family wedding', createdAt: new Date(NOW.getTime() - 5 * 3600000) } })
  }
  console.info(`  ${badges} badges, ${dues.length} UPI claims and ${membership ? 1 : 0} freeze request waiting (${spec.slug})`)
}

// ---------------------------------------------------------------------------
// Phase 8: app activity, this week's at-risk list (two already called) and
// a resolved complaint.
// ---------------------------------------------------------------------------
async function seedGrowth(gymId: string, spec: GymSpec) {
  const tdb = scopeToGym(db, gymId)
  const athletes = await db.athlete.findMany({ where: { gymId }, select: { id: true, lastVisitAt: true }, orderBy: { memberCode: 'asc' } })
  for (const [i, a] of athletes.entries()) {
    // Most members open the app around their visits; some never installed it.
    const base = a.lastVisitAt ?? new Date(NOW.getTime() - 30 * DAY)
    const lastAppAt = i % 7 === 3 ? null : new Date(Math.min(NOW.getTime(), base.getTime() + int(0, 2) * DAY))
    await db.athlete.update({ where: { id: a.id }, data: { lastAppAt } })
  }
  const risk = await computeWeeklyRisk(tdb, gymId, NOW)
  const top = await db.riskScore.findMany({ where: { gymId, weekOf: risk.weekOf }, orderBy: { score: 'desc' }, take: 6 })
  const owner = await db.gymUser.findFirst({ where: { gymId, kind: 'OWNER' } })
  const outcomes = [
    { outcome: 'REACHED_COMING_BACK' as const, note: 'Was travelling for work, back from Monday' },
    { outcome: 'NO_ANSWER' as const, note: '' },
  ]
  for (const [i, o] of outcomes.entries()) {
    const row = top[top.length - 1 - i]
    if (row && owner) await db.riskScore.update({ where: { id: row.id }, data: { contacted: o.outcome !== 'NO_ANSWER', outcome: o.outcome, note: o.note || null, contactedById: owner.id, contactedAt: new Date(NOW.getTime() - 3 * 3600000) } })
  }
  const branch = await db.branch.findFirst({ where: { gymId }, orderBy: { createdAt: 'asc' } })
  await db.complaint.create({ data: { gymId, branchId: branch?.id, athleteId: athletes[5]?.id, kind: 'EQUIPMENT', title: 'Cable machine pin missing', body: 'The pin on the left cable stack is missing.', status: 'RESOLVED', resolvedById: owner?.id, resolvedAt: new Date(NOW.getTime() - 2 * DAY), resolutionNote: 'New pin fitted, both stacks checked.', createdAt: new Date(NOW.getTime() - 4 * DAY) } })
  console.info(`  ${spec.name}: ${risk.atRisk} members on this week's at-risk list`)
}

// ---------------------------------------------------------------------------
// Phase 7: saved workout plans, PT sessions (confirmed, waiting, one
// disputed) and trainer notes the members see in their app.
// ---------------------------------------------------------------------------
async function seedTrainerDesk(gymId: string) {
  const trainers = await db.gymUser.findMany({ where: { gymId, kind: 'TRAINER' }, orderBy: { phone: 'asc' } })
  if (trainers.length === 0) return
  // Owners who train get notes and PT sessions on their roster too.
  const owner = await db.gymUser.findFirst({ where: { gymId, kind: 'OWNER' } })
  if (owner && (await db.athlete.count({ where: { gymId, trainerId: owner.id } }))) trainers.push(owner)
  const day = (weekday: number, title: string, focus: string, exercises: [string, number, string][]) => ({ weekday, title, focus, minutes: 60, exercises: exercises.map(([name, sets, reps]) => ({ name, sets, reps })) })
  const plans = [
    { name: 'Beginner full body (3 days)', goal: 'First 8 weeks, build the habit', days: [day(1, 'Full body A', 'Squat, push, pull', [['Goblet squat', 3, '12'], ['Push-ups', 3, '10'], ['Lat pulldown', 3, '12'], ['Plank', 3, '30s']]), day(3, 'Full body B', 'Hinge, press, row', [['Romanian deadlift', 3, '10'], ['Dumbbell press', 3, '10'], ['Seated row', 3, '12'], ['Walking lunges', 2, '12']]), day(5, 'Full body C', 'Conditioning', [['Leg press', 3, '12'], ['Incline press', 3, '10'], ['Cable row', 3, '12'], ['Bike intervals', 1, '10 min']])], diet: 'Protein with every meal: dal, paneer, eggs, curd or chicken. 3 litres of water. Keep sugar for weekends.' },
    { name: 'Push / pull / legs (6 days)', goal: 'Muscle gain, intermediate', days: [day(1, 'Push', 'Chest, shoulders, triceps', [['Bench press', 4, '6-8'], ['Overhead press', 3, '8'], ['Incline DB press', 3, '10'], ['Triceps pushdown', 3, '12']]), day(2, 'Pull', 'Back, biceps', [['Deadlift', 3, '5'], ['Pull-ups', 4, 'max'], ['Barbell row', 3, '8'], ['Barbell curl', 3, '10']]), day(3, 'Legs', 'Quads, hamstrings', [['Back squat', 4, '6'], ['Leg press', 3, '10'], ['Leg curl', 3, '12'], ['Calf raise', 4, '15']]), day(4, 'Push', 'Volume', [['Incline bench', 4, '8'], ['Dips', 3, '10'], ['Lateral raise', 4, '15']]), day(5, 'Pull', 'Volume', [['Lat pulldown', 4, '10'], ['Seated row', 3, '12'], ['Hammer curl', 3, '12']]), day(6, 'Legs', 'Volume', [['Front squat', 3, '8'], ['RDL', 3, '10'], ['Lunges', 3, '12']])], diet: 'Eat in a small surplus: add a glass of milk and a banana-peanut butter roti after training. 1.6 g protein per kg body weight.' },
    { name: 'Fat loss circuit (4 days)', goal: 'Fat loss, keep strength', days: [day(1, 'Upper circuit', 'Push + pull', [['DB press', 3, '12'], ['Cable row', 3, '12'], ['Shoulder press', 3, '12']]), day(2, 'Lower circuit', 'Legs + core', [['Goblet squat', 3, '15'], ['Step-ups', 3, '12'], ['Hanging knee raise', 3, '12']]), day(4, 'Full body', 'Strength', [['Deadlift', 3, '6'], ['Bench press', 3, '8'], ['Pull-ups', 3, 'max']]), day(5, 'Cardio + core', 'Conditioning', [['Rowing', 1, '15 min'], ['Plank', 3, '45s'], ['Battle ropes', 5, '30s']])], diet: 'Small calorie deficit, never crash diets. Fill half the plate with sabzi and salad. Walk 8,000 steps a day.' },
  ]
  for (const [i, plan] of plans.entries()) {
    await db.workoutTemplate.create({ data: { gymId, createdById: trainers[i % trainers.length].id, name: plan.name, goal: plan.goal, days: { days: plan.days }, dietNotes: plan.diet } })
  }

  const notes = ['Great depth on squats today. Next week we add 5 kg.', 'Keep your elbows tucked on bench, it will save your shoulders.', 'Sleep 7+ hours this week, your recovery will thank you.', 'Proud of the consistency this month. Keep it going!']
  let sessions = 0
  for (const trainer of trainers) {
    const roster = await db.athlete.findMany({ where: { gymId, trainerId: trainer.id, archived: false }, orderBy: { memberCode: 'asc' }, take: 12 })
    for (const [i, athlete] of roster.entries()) {
      if (i < 4) await db.trainerNote.create({ data: { gymId, athleteId: athlete.id, trainerId: trainer.id, body: notes[i], createdAt: new Date(NOW.getTime() - (i + 1) * 2 * DAY) } })
      if (i >= 6) continue
      for (let k = 0; k < int(3, 8); k += 1) {
        const at = new Date(TODAY.getTime() - int(0, 27) * DAY + (int(7, 20) * 60 + pick([0, 30])) * 60000)
        if (at.getTime() > NOW.getTime()) continue
        const roll = rand()
        const recent = NOW.getTime() - at.getTime() < 3 * DAY
        const signed = !recent || roll < 0.5
        const disputed = !signed && roll > 0.93
        await db.ptSession.create({
          data: { gymId, athleteId: athlete.id, trainerId: trainer.id, sessionAt: at, durationMin: pick([45, 60, 60, 75]), notes: pick(['Legs and core', 'Upper body strength', 'Technique: deadlift', 'Conditioning circuit', '']), commissionPaise: Math.round(((trainer.ptSessionFeePaise ?? 0) * trainer.commissionPct) / 100), athleteSignedAt: signed ? new Date(at.getTime() + 2 * 3600000) : null, athleteDisputedAt: disputed ? new Date(at.getTime() + 3 * 3600000) : null, disputeNote: disputed ? 'I did not have a session that day' : null },
        })
        sessions += 1
      }
    }
  }
  // The demo member always has one session waiting for them to confirm.
  const demo = await db.athlete.findFirst({ where: { gymId }, orderBy: { memberCode: 'asc' } })
  if (demo?.trainerId) {
    const trainer = trainers.find((t) => t.id === demo.trainerId)
    await db.ptSession.create({ data: { gymId, athleteId: demo.id, trainerId: demo.trainerId, sessionAt: new Date(NOW.getTime() - 3 * 3600000), durationMin: 60, notes: 'Push day, bench technique', commissionPaise: Math.round(((trainer?.ptSessionFeePaise ?? 0) * (trainer?.commissionPct ?? 0)) / 100) } })
    await db.trainerNote.create({ data: { gymId, athleteId: demo.id, trainerId: demo.trainerId, body: 'Solid bench session today! Keep the bar path straight and we push for 90 kg next month.', createdAt: new Date(NOW.getTime() - 2 * 3600000) } })
  }
  console.info(`  ${plans.length} workout plans, ${sessions} PT sessions, trainer notes`)
}

// `pnpm db:bootstrap` (production): Rep+ plans, badge rules and the super
// admin only. `pnpm db:seed` (development): all of that plus the demo gyms.
const PLATFORM_ONLY = process.argv.includes('--platform-only')
// `--only=sharp-fitness` (re)loads one demo gym and nothing else, so a
// showcase database holds only that gym. Re-running resets it.
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? null

async function main() {
  console.info(PLATFORM_ONLY ? 'Bootstrapping Rep+ (plans, badges, super admin)...' : 'Seeding Rep+...')
  await seedPlatform()
  await seedAdmin()
  if (PLATFORM_ONLY) return
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force-demo')) {
    throw new Error('Refusing to load demo gyms with NODE_ENV=production. Use pnpm db:bootstrap.')
  }
  invoiceSeq = new Map()
  await db.platformInvoice.deleteMany({ where: { razorpayPaymentId: { startsWith: 'pay_seed' } } })
  const specs = ONLY ? GYMS.filter((spec) => spec.slug === ONLY) : GYMS
  if (ONLY && specs.length === 0) throw new Error(`No demo gym with slug "${ONLY}". Known: ${GYMS.map((g) => g.slug).join(', ')}`)
  for (const spec of specs) await seedGym(spec)
  if (!ONLY) await seedPlatformGyms()
  for (const [fy, value] of invoiceSeq.entries()) {
    const existing = await db.platformCounter.findUnique({ where: { key: `invoice:${fy}` } })
    await db.platformCounter.upsert({ where: { key: `invoice:${fy}` }, create: { key: `invoice:${fy}`, value }, update: { value: Math.max(value, existing?.value ?? 0) } })
  }
  console.info('')
  console.info('The Sharp Fitness (/g/sharp-fitness):')
  console.info(`  Owner Jagtar Singh:   jagtar@thesharpfitness.in / ${DEMO_PASSWORD}   phone +91 98765 30000 (also desk + trainer)`)
  console.info('  Trainers:             Inder +91 98765 30011, Lakshay +91 98765 30012, Daniel +91 98765 30013')
  console.info('  Members:              Manmeet Singh +91 98765 31001, Surajdeep +91 98765 31002')
  if (ONLY) return
  console.info('')
  console.info('Demo logins (OTP codes print in the dev server terminal when DEV_LOG_OTP=true):')
  console.info(`  Forge owner (email):  gurpreet@forgefitness.in / ${DEMO_PASSWORD}   phone +91 98765 00001`)
  console.info(`  Iron Temple owner:    rajesh@irontemple.in / ${DEMO_PASSWORD}       phone +91 98765 00002`)
  console.info('  Iron Temple desk:     phone +91 98765 00003')
  console.info('  Trainers:             +91 98765 00011 (Forge), +91 98765 00021 (Iron Temple)')
  console.info('  Athletes:             /g/forge-fitness/login  +91 98765 11111')
  console.info('                        /g/iron-temple/login    +91 98765 22222')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
