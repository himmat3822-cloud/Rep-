import type { TenantDb } from '@/lib/db/tenant-core'
import { decryptOptional } from '@/lib/crypto'

// "Download my data": everything the gym's Rep+ holds about one member.
// Money in rupees, dates as ISO strings. Photos are listed (not embedded).

const rupees = (paise: number) => Math.round(paise) / 100

export async function buildDataExport(db: TenantDb, gym: { id: string; name: string }, athleteId: string) {
  const athlete = await db.athlete.findFirstOrThrow({ where: { id: athleteId } })
  const [memberships, payments, invoices, dues, checkIns, bookings, splits, logs, photos, records, badges, challenges, claims, freezes, complaints, notifications, referrals] = await Promise.all([
    db.membership.findMany({ where: { athleteId }, orderBy: { startsAt: 'asc' } }),
    db.payment.findMany({ where: { athleteId }, orderBy: { createdAt: 'asc' } }),
    db.invoice.findMany({ where: { athleteId }, orderBy: { issuedAt: 'asc' } }),
    db.due.findMany({ where: { athleteId }, orderBy: { dueDate: 'asc' } }),
    db.checkIn.findMany({ where: { athleteId }, orderBy: { checkedInAt: 'asc' } }),
    db.slotBooking.findMany({ where: { athleteId }, orderBy: { createdAt: 'asc' } }),
    db.workoutSplit.findMany({ where: { athleteId } }),
    db.progressLog.findMany({ where: { athleteId }, orderBy: { loggedOn: 'asc' } }),
    db.progressPhoto.findMany({ where: { athleteId }, orderBy: { takenOn: 'asc' } }),
    db.personalRecord.findMany({ where: { athleteId }, orderBy: { achievedOn: 'asc' } }),
    db.athleteBadge.findMany({ where: { athleteId } }),
    db.challengeEntry.findMany({ where: { athleteId } }),
    db.memberPaymentClaim.findMany({ where: { athleteId } }),
    db.freezeRequest.findMany({ where: { athleteId } }),
    db.complaint.findMany({ where: { athleteId } }),
    db.notification.findMany({ where: { recipientType: 'ATHLETE', recipientId: athleteId } }),
    db.referral.findMany({ where: { referrerId: athleteId } }),
  ])
  const plans = await db.membershipPlan.findMany({ where: { id: { in: memberships.map((m) => m.planId) } }, select: { id: true, name: true } })
  const planName = new Map(plans.map((p) => [p.id, p.name]))

  return {
    exportedAt: new Date().toISOString(),
    gym: gym.name,
    profile: {
      memberCode: athlete.memberCode,
      name: athlete.name,
      phone: athlete.phone,
      email: athlete.email,
      gender: athlete.gender,
      dateOfBirth: athlete.dateOfBirth,
      joinedAt: athlete.joinedAt,
      language: athlete.language,
      emergencyContact: decryptOptional(athlete.emergencyContactEnc),
      medicalNotes: decryptOptional(athlete.medicalNotesEnc),
      referralCode: athlete.referralCode,
      privacy: {
        shareProgressWithTrainer: athlete.shareProgressWithTrainer,
        sharePhotosWithTrainer: athlete.sharePhotosWithTrainer,
        shareHealthWithTrainer: athlete.shareHealthWithTrainer,
        hideFromLeaderboard: athlete.hideFromLeaderboard,
        whatsappOptOut: athlete.whatsappOptOut,
      },
      streakDays: athlete.streakDays,
      bestStreak: athlete.bestStreak,
    },
    memberships: memberships.map((m) => ({ plan: planName.get(m.planId) ?? m.planId, status: m.status, startsAt: m.startsAt, endsAt: m.endsAt, priceRupees: rupees(m.pricePaise), discountRupees: rupees(m.discountPaise), freezeDaysUsed: m.freezeDaysUsed })),
    payments: payments.map((p) => ({ amountRupees: rupees(p.amountPaise), method: p.method, status: p.status, paidAt: p.paidAt, note: p.note })),
    invoices: invoices.map((i) => ({ number: i.number, totalRupees: rupees(i.totalPaise), taxableRupees: rupees(i.taxablePaise), cgstRupees: rupees(i.cgstPaise), sgstRupees: rupees(i.sgstPaise), issuedAt: i.issuedAt })),
    dues: dues.map((d) => ({ amountRupees: rupees(d.amountPaise), dueDate: d.dueDate, status: d.status, paidAt: d.paidAt })),
    checkIns: checkIns.map((c) => ({ in: c.checkedInAt, out: c.checkedOutAt, method: c.method })),
    slotBookings: bookings.map((b) => ({ slotId: b.slotId, status: b.status, bookedAt: b.createdAt })),
    workoutSplits: splits.map((s) => ({ days: s.days, dietNotes: s.dietNotes, active: s.active, byTrainer: Boolean(s.createdById) })),
    progressLogs: logs.map(({ id: _id, gymId: _gym, athleteId: _a, ...rest }) => rest),
    progressPhotos: photos.map((p) => ({ takenOn: p.takenOn, pose: p.pose, storedPrivately: true })),
    personalRecords: records.map((r) => ({ exercise: r.exercise, weightKg: r.weightKg, reps: r.reps, achievedOn: r.achievedOn })),
    badges: badges.map((b) => ({ badge: b.badgeKey, earnedAt: b.earnedAt })),
    challenges: challenges.map((c) => ({ challengeId: c.challengeId, progress: c.progress, completedAt: c.completedAt })),
    paymentClaims: claims.map((c) => ({ kind: c.kind, amountRupees: rupees(c.amountPaise), upiReference: c.utr, status: c.status, decision: c.decision, createdAt: c.createdAt })),
    freezeRequests: freezes.map((f) => ({ fromDate: f.fromDate, days: f.days, reason: f.reason, status: f.status })),
    feedback: complaints.map((c) => ({ kind: c.kind, title: c.title, body: c.body, status: c.status, createdAt: c.createdAt })),
    notifications: notifications.map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt })),
    referrals: referrals.map((r) => ({ rewardDays: r.rewardDays, rewardedAt: r.rewardedAt, createdAt: r.createdAt })),
  }
}
