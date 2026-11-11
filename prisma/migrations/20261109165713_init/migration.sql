-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "StaffKind" AS ENUM ('OWNER', 'TRAINER', 'DESK');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'HI', 'PA');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('NEW', 'REGULAR', 'SLIPPING', 'INACTIVE', 'EXPIRED', 'FROZEN');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DueStatus" AS ENUM ('OPEN', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_ROTATING', 'QR_ENTRANCE', 'MANUAL', 'BIOMETRIC');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'INSTAGRAM', 'GOOGLE', 'REFERRAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'TRIAL', 'FOLLOW_UP', 'JOINED', 'LOST');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'INAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('ADMIN', 'STAFF', 'ATHLETE');

-- CreateEnum
CREATE TYPE "OtpScope" AS ENUM ('STAFF', 'ATHLETE');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DUE', 'PAID', 'FAILED', 'VOID');

-- CreateEnum
CREATE TYPE "ComplaintKind" AS ENUM ('FEEDBACK', 'EQUIPMENT', 'CLEANLINESS', 'STAFF', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "HealthMetricType" AS ENUM ('STEPS', 'ACTIVE_CALORIES', 'HEART_RATE', 'SLEEP_MINUTES', 'WEIGHT_KG', 'WORKOUT_MINUTES');

-- CreateEnum
CREATE TYPE "HealthSource" AS ENUM ('MANUAL', 'TERRA', 'HEALTHKIT', 'HEALTH_CONNECT');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARY', 'ELECTRICITY', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskContactOutcome" AS ENUM ('PENDING', 'REACHED_COMING_BACK', 'REACHED_NOT_INTERESTED', 'NO_ANSWER', 'RENEWED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTotpStep" INTEGER,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "monthlyPricePaise" INTEGER NOT NULL,
    "annualPricePaise" INTEGER NOT NULL,
    "memberLimit" INTEGER,
    "branchLimit" INTEGER NOT NULL,
    "extraBranchPaise" INTEGER,
    "staffLimit" INTEGER,
    "trainerLimit" INTEGER,
    "deskLimit" INTEGER,
    "whatsappQuota" INTEGER NOT NULL,
    "features" TEXT[],
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymSubscription" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "dataPurgeAfter" TIMESTAMP(3),
    "razorpaySubscriptionId" TEXT,
    "razorpayCustomerId" TEXT,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymOverride" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "customPricePaise" INTEGER,
    "extraMembers" INTEGER NOT NULL DEFAULT 0,
    "extraBranches" INTEGER NOT NULL DEFAULT 0,
    "extraStaff" INTEGER NOT NULL DEFAULT 0,
    "extraFeatures" TEXT[],
    "removedFeatures" TEXT[],
    "whatsappTopUp" INTEGER NOT NULL DEFAULT 0,
    "freeMonthsLeft" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "razorpayPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sendWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "gymId" TEXT,
    "actorType" "PrincipalType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "adminUserId" TEXT,
    "impersonatedBy" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gym" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "gstNumber" TEXT,
    "logoPublicId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "ownerHandlesDesk" BOOLEAN NOT NULL DEFAULT true,
    "athleteLabel" TEXT NOT NULL DEFAULT 'Athlete',
    "athleteLabelPlural" TEXT NOT NULL DEFAULT 'Athletes',
    "defaultLanguage" "Language" NOT NULL DEFAULT 'EN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "sessionMinutes" INTEGER NOT NULL DEFAULT 75,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "customDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geofenceMeters" INTEGER NOT NULL DEFAULT 150,
    "hourlyCapacity" INTEGER NOT NULL DEFAULT 40,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "openingHours" JSONB NOT NULL DEFAULT '{}',
    "holidays" DATE[],
    "entranceQrSecret" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymUser" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "roleId" TEXT NOT NULL,
    "kind" "StaffKind" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "grants" TEXT[],
    "denies" TEXT[],
    "commissionPct" INTEGER NOT NULL DEFAULT 0,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "homeBranchId" TEXT NOT NULL,
    "trainerId" TEXT,
    "memberCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATE,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "emergencyContactEnc" TEXT,
    "medicalNotesEnc" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'NEW',
    "statusComputedAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "restDays" INTEGER[],
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "hideFromLeaderboard" BOOLEAN NOT NULL DEFAULT false,
    "shareProgressWithTrainer" BOOLEAN NOT NULL DEFAULT true,
    "sharePhotosWithTrainer" BOOLEAN NOT NULL DEFAULT false,
    "shareHealthWithTrainer" BOOLEAN NOT NULL DEFAULT false,
    "lastAppOpenAt" TIMESTAMP(3),
    "pushSubscription" JSONB,
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "joiningFeePaise" INTEGER NOT NULL DEFAULT 0,
    "gstPercent" INTEGER NOT NULL DEFAULT 18,
    "gstInclusive" BOOLEAN NOT NULL DEFAULT true,
    "maxFreezeDays" INTEGER NOT NULL DEFAULT 0,
    "crossBranch" BOOLEAN NOT NULL DEFAULT false,
    "ptAddonPaise" INTEGER,
    "ptSessionsIncluded" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "freezeDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "frozenFrom" DATE,
    "frozenUntil" DATE,
    "ptSessionsLeft" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreezeRequest" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreezeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "membershipId" TEXT,
    "dueId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpayLinkId" TEXT,
    "collectedById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL,
    "sgstPaise" INTEGER NOT NULL,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "lineItems" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Due" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "membershipId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "DueStatus" NOT NULL DEFAULT 'OPEN',
    "reminderStage" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "paymentLinkId" TEXT,
    "paymentLinkUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Due_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "spentOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "method" "CheckInMethod" NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "autoCheckout" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrNonce" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startHour" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotBooking" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeakHourStat" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "planned" INTEGER NOT NULL DEFAULT 0,
    "actual" INTEGER NOT NULL DEFAULT 0,
    "weekOf" DATE NOT NULL,

    CONSTRAINT "PeakHourStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderStage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "customText" TEXT,
    "notifyOwner" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReminderStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT,
    "staffId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "purpose" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppUsage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "warned80" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WhatsAppUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "recipientType" "PrincipalType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "interest" TEXT NOT NULL DEFAULT '',
    "nextFollowUpAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "convertedAthleteId" TEXT,
    "lostReason" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScore" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "contacted" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "RiskContactOutcome" NOT NULL DEFAULT 'PENDING',
    "contactedById" TEXT,
    "contactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredAthleteId" TEXT,
    "referredLeadId" TEXT,
    "rewardDays" INTEGER NOT NULL,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "badgeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeEntry" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChallengeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthleteBadge" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthleteBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationLine" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "language" "Language" NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'groq',

    CONSTRAINT "MotivationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "athleteId" TEXT,
    "kind" "ComplaintKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "photoPublicId" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSplit" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdById" TEXT,
    "days" JSONB NOT NULL,
    "dietNotes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerNote" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtSession" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "sessionAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "notes" TEXT NOT NULL DEFAULT '',
    "athleteSignedAt" TIMESTAMP(3),
    "commissionPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressLog" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "loggedOn" DATE NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "chestCm" DOUBLE PRECISION,
    "waistCm" DOUBLE PRECISION,
    "hipsCm" DOUBLE PRECISION,
    "armsCm" DOUBLE PRECISION,
    "thighsCm" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "pose" TEXT NOT NULL DEFAULT 'front',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL DEFAULT 1,
    "achievedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthConsent" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "type" "HealthMetricType" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "shareWithStaff" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthConnection" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "source" "HealthSource" NOT NULL,
    "externalUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "HealthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMetric" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "type" "HealthMetricType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "source" "HealthSource" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "scope" "OtpScope" NOT NULL,
    "phone" TEXT NOT NULL,
    "gymId" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "gymId" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_adminId_key" ON "AdminUser"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPlan_code_key" ON "PlatformPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GymSubscription_gymId_key" ON "GymSubscription"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "GymSubscription_razorpaySubscriptionId_key" ON "GymSubscription"("razorpaySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "GymOverride_gymId_key" ON "GymOverride"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_razorpayPaymentId_key" ON "PlatformInvoice"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueAt_idx" ON "PlatformInvoice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "AuditLog_gymId_createdAt_idx" ON "AuditLog"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Gym_slug_key" ON "Gym"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Gym_customDomain_key" ON "Gym"("customDomain");

-- CreateIndex
CREATE INDEX "Branch_gymId_idx" ON "Branch"("gymId");

-- CreateIndex
CREATE INDEX "Role_gymId_idx" ON "Role"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_gymId_key_key" ON "Role"("gymId", "key");

-- CreateIndex
CREATE INDEX "GymUser_gymId_idx" ON "GymUser"("gymId");

-- CreateIndex
CREATE INDEX "GymUser_phone_idx" ON "GymUser"("phone");

-- CreateIndex
CREATE INDEX "GymUser_email_idx" ON "GymUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GymUser_gymId_phone_key" ON "GymUser"("gymId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "GymUser_gymId_email_key" ON "GymUser"("gymId", "email");

-- CreateIndex
CREATE INDEX "Athlete_gymId_status_idx" ON "Athlete"("gymId", "status");

-- CreateIndex
CREATE INDEX "Athlete_gymId_homeBranchId_idx" ON "Athlete"("gymId", "homeBranchId");

-- CreateIndex
CREATE INDEX "Athlete_gymId_trainerId_idx" ON "Athlete"("gymId", "trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_gymId_phone_key" ON "Athlete"("gymId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_gymId_memberCode_key" ON "Athlete"("gymId", "memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_gymId_referralCode_key" ON "Athlete"("gymId", "referralCode");

-- CreateIndex
CREATE INDEX "MembershipPlan_gymId_idx" ON "MembershipPlan"("gymId");

-- CreateIndex
CREATE INDEX "Membership_gymId_athleteId_idx" ON "Membership"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "Membership_gymId_endsAt_idx" ON "Membership"("gymId", "endsAt");

-- CreateIndex
CREATE INDEX "FreezeRequest_gymId_status_idx" ON "FreezeRequest"("gymId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayLinkId_key" ON "Payment"("razorpayLinkId");

-- CreateIndex
CREATE INDEX "Payment_gymId_paidAt_idx" ON "Payment"("gymId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_gymId_athleteId_idx" ON "Payment"("gymId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");

-- CreateIndex
CREATE INDEX "Invoice_gymId_issuedAt_idx" ON "Invoice"("gymId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_gymId_number_key" ON "Invoice"("gymId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_gymId_financialYear_sequence_key" ON "Invoice"("gymId", "financialYear", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCounter_gymId_financialYear_key" ON "InvoiceCounter"("gymId", "financialYear");

-- CreateIndex
CREATE INDEX "Due_gymId_status_dueDate_idx" ON "Due"("gymId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Due_gymId_athleteId_idx" ON "Due"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "Expense_gymId_spentOn_idx" ON "Expense"("gymId", "spentOn");

-- CreateIndex
CREATE INDEX "CheckIn_gymId_branchId_checkedInAt_idx" ON "CheckIn"("gymId", "branchId", "checkedInAt");

-- CreateIndex
CREATE INDEX "CheckIn_gymId_athleteId_checkedInAt_idx" ON "CheckIn"("gymId", "athleteId", "checkedInAt");

-- CreateIndex
CREATE INDEX "QrNonce_expiresAt_idx" ON "QrNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QrNonce_gymId_nonce_key" ON "QrNonce"("gymId", "nonce");

-- CreateIndex
CREATE INDEX "Slot_gymId_date_idx" ON "Slot"("gymId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_gymId_branchId_date_startHour_key" ON "Slot"("gymId", "branchId", "date", "startHour");

-- CreateIndex
CREATE INDEX "SlotBooking_gymId_athleteId_idx" ON "SlotBooking"("gymId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotBooking_slotId_athleteId_key" ON "SlotBooking"("slotId", "athleteId");

-- CreateIndex
CREATE INDEX "PeakHourStat_gymId_branchId_weekOf_idx" ON "PeakHourStat"("gymId", "branchId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "PeakHourStat_gymId_branchId_weekOf_weekday_hour_key" ON "PeakHourStat"("gymId", "branchId", "weekOf", "weekday", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderStage_gymId_stage_key" ON "ReminderStage"("gymId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_providerId_key" ON "MessageLog"("providerId");

-- CreateIndex
CREATE INDEX "MessageLog_gymId_createdAt_idx" ON "MessageLog"("gymId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_gymId_dedupeKey_key" ON "MessageLog"("gymId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppUsage_gymId_month_key" ON "WhatsAppUsage"("gymId", "month");

-- CreateIndex
CREATE INDEX "Notification_gymId_recipientType_recipientId_readAt_idx" ON "Notification"("gymId", "recipientType", "recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Announcement_gymId_createdAt_idx" ON "Announcement"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_gymId_stage_idx" ON "Lead"("gymId", "stage");

-- CreateIndex
CREATE INDEX "Lead_gymId_nextFollowUpAt_idx" ON "Lead"("gymId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "RiskScore_gymId_weekOf_score_idx" ON "RiskScore"("gymId", "weekOf", "score");

-- CreateIndex
CREATE UNIQUE INDEX "RiskScore_gymId_athleteId_weekOf_key" ON "RiskScore"("gymId", "athleteId", "weekOf");

-- CreateIndex
CREATE INDEX "Referral_gymId_referrerId_idx" ON "Referral"("gymId", "referrerId");

-- CreateIndex
CREATE INDEX "Challenge_gymId_endsAt_idx" ON "Challenge"("gymId", "endsAt");

-- CreateIndex
CREATE INDEX "ChallengeEntry_gymId_idx" ON "ChallengeEntry"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeEntry_challengeId_athleteId_key" ON "ChallengeEntry"("challengeId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeRule_key_key" ON "BadgeRule"("key");

-- CreateIndex
CREATE INDEX "AthleteBadge_gymId_idx" ON "AthleteBadge"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "AthleteBadge_athleteId_badgeKey_key" ON "AthleteBadge"("athleteId", "badgeKey");

-- CreateIndex
CREATE INDEX "MotivationLine_gymId_date_idx" ON "MotivationLine"("gymId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MotivationLine_athleteId_date_key" ON "MotivationLine"("athleteId", "date");

-- CreateIndex
CREATE INDEX "Complaint_gymId_status_idx" ON "Complaint"("gymId", "status");

-- CreateIndex
CREATE INDEX "WorkoutSplit_gymId_athleteId_idx" ON "WorkoutSplit"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "TrainerNote_gymId_athleteId_idx" ON "TrainerNote"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "PtSession_gymId_trainerId_sessionAt_idx" ON "PtSession"("gymId", "trainerId", "sessionAt");

-- CreateIndex
CREATE INDEX "PtSession_gymId_athleteId_idx" ON "PtSession"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "ProgressLog_gymId_athleteId_idx" ON "ProgressLog"("gymId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressLog_athleteId_loggedOn_key" ON "ProgressLog"("athleteId", "loggedOn");

-- CreateIndex
CREATE INDEX "ProgressPhoto_gymId_athleteId_idx" ON "ProgressPhoto"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "PersonalRecord_gymId_athleteId_exercise_idx" ON "PersonalRecord"("gymId", "athleteId", "exercise");

-- CreateIndex
CREATE INDEX "HealthConsent_gymId_idx" ON "HealthConsent"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthConsent_athleteId_type_key" ON "HealthConsent"("athleteId", "type");

-- CreateIndex
CREATE INDEX "HealthConnection_externalUserId_idx" ON "HealthConnection"("externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthConnection_athleteId_source_key" ON "HealthConnection"("athleteId", "source");

-- CreateIndex
CREATE INDEX "HealthMetric_gymId_athleteId_type_recordedAt_idx" ON "HealthMetric"("gymId", "athleteId", "type", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HealthMetric_athleteId_type_source_recordedAt_key" ON "HealthMetric"("athleteId", "type", "source", "recordedAt");

-- CreateIndex
CREATE INDEX "OtpCode_phone_scope_createdAt_idx" ON "OtpCode"("phone", "scope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_principalType_principalId_idx" ON "RefreshToken"("principalType", "principalId");

-- CreateIndex
CREATE INDEX "RefreshToken_gymId_idx" ON "RefreshToken"("gymId");

-- CreateIndex
CREATE INDEX "RateLimitHit_windowStart_idx" ON "RateLimitHit"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "GymSubscription" ADD CONSTRAINT "GymSubscription_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymSubscription" ADD CONSTRAINT "GymSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymOverride" ADD CONSTRAINT "GymOverride_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "GymSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymUser" ADD CONSTRAINT "GymUser_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymUser" ADD CONSTRAINT "GymUser_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymUser" ADD CONSTRAINT "GymUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "GymUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerNote" ADD CONSTRAINT "TrainerNote_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "GymUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtSession" ADD CONSTRAINT "PtSession_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "GymUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
